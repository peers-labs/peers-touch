#!/usr/bin/env python3
"""Build the Desktop performance Dev/CI report from Station mirror and matrix gate artifacts."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, latest_path, latest_ref


PRODUCER_GATE_ID = "desktop-performance-report-gate"
DEFAULT_OUTPUT_PREFIX = "reports/desktop-performance-report-latest"
MIRROR_REQUIRED_PHASE = "P0a-6/P0c-5"
MIRROR_REQUIRED_BOM = ("BOM-CAP-05", "BOM-RUN-05")
MIRROR_REQUIRED_SPEC = ("SPEC-STA-03", "SPEC-MIRROR-01")
MIRROR_REQUIRED_ARTIFACT_KIND = "desktop-performance-station-mirror"
MIRROR_REQUIRED_PRODUCT_SINK = "Station"
MIRROR_REQUIRED_ROLE = "Dev/CI evidence artifact"
REPORT_ARTIFACT_KIND = "desktop-performance-report"
REPORT_PHASE = "P0c-5"
REPORT_BOM = ("BOM-RUN-05", "BOM-CAP-05")
REPORT_SPEC = ("SPEC-MIRROR-01", "SPEC-STA-03")
REPORT_GATE = (
    "Final Desktop performance report must preserve source evidence, blocked reasons, red-line state, "
    "and fail-closed diagnostics before proof is allowed"
)
PREFLIGHT_REQUIRED_PHASE = "P0c-1/P0c-2"
PREFLIGHT_REQUIRED_BOM = ("BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01")
PREFLIGHT_REQUIRED_SPEC = ("SPEC-RUN-01", "SPEC-GATE-01")
PREFLIGHT_REQUIRED_ARTIFACT_KIND = "desktop-performance-preflight"
ANCHOR_SOURCE_REQUIRED_PHASE = "P0b-1"
ANCHOR_SOURCE_REQUIRED_BOM = ("BOM-SMP-01",)
ANCHOR_SOURCE_REQUIRED_SPEC = ("SPEC-ANCHOR-01",)
ANCHOR_SOURCE_REQUIRED_GATE = (
    "Desktop source must expose required stable anchors before DOM automation evidence can be accepted"
)
AGGREGATION_TRACE = {
    "reactCommitAggregation": {
        "scope": "react-commit-aggregation",
        "phase": "P0b-3/P0c-5",
        "bom": ["BOM-SMP-02", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-REACT-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "React commit sampler evidence must be present in Station mirror before report proof is allowed",
    },
    "storeUpdateAggregation": {
        "scope": "store-update-aggregation",
        "phase": "P0b-4/P0c-5",
        "bom": ["BOM-SMP-03", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-STORE-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Store update sampler evidence must be present in Station mirror before report proof is allowed",
    },
    "overlayLatencyAggregation": {
        "scope": "overlay-latency-aggregation",
        "phase": "P0b-5/P0c-5",
        "bom": ["BOM-SMP-04", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-OVERLAY-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Overlay intent/visible latency evidence must be present in Station mirror before report proof is allowed",
    },
    "invokeAggregation": {
        "scope": "invoke-aggregation",
        "phase": "P0b-6/P0c-5",
        "bom": ["BOM-SMP-05", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-INVOKE-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Invoke started/completed/failed evidence must be present in Station mirror before report proof is allowed",
    },
    "mainThreadExceptions": {
        "scope": "main-thread-exceptions",
        "phase": "P0b-7/P0c-5",
        "bom": ["BOM-SMP-06", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-MAIN-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Main-thread longtask/layout/paint evidence must either be within budget or carry an explicit exception",
    },
}
INTERACTION_CORRELATION_TRACE = {
    "scope": "interaction-correlation",
    "phase": "P0b-2/P0c-5",
    "bom": ["BOM-CON-02", "BOM-RUN-05", "BOM-CAP-05"],
    "spec": ["SPEC-INT-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
    "gate": "Interaction-correlated event families must carry interactionId before report proof is allowed",
}
SAMPLER_GATE_REQUIRED_PHASE = "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5"
SAMPLER_GATE_REQUIRED_BOM = (
    "BOM-CON-02",
    "BOM-CAP-03",
    "BOM-SMP-02",
    "BOM-SMP-03",
    "BOM-SMP-04",
    "BOM-SMP-05",
    "BOM-SMP-06",
)
SAMPLER_GATE_REQUIRED_SPEC = (
    "SPEC-INT-01",
    "SPEC-SMP-REACT-01",
    "SPEC-SMP-STORE-01",
    "SPEC-SMP-OVERLAY-01",
    "SPEC-SMP-INVOKE-01",
    "SPEC-SMP-MAIN-01",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_json_if_present(path: Path) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    if not path.exists():
        return None, {"path": str(path), "status": "missing"}
    return json.loads(path.read_text(encoding="utf-8")), {"path": str(path), "status": "loaded"}


def report_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Run the P0a live telemetry gate to populate Station mirror source evidence.",
            "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py",
        },
        {
            "purpose": "Run the P0b sampler gate after Station mirror events are available.",
            "command": "python3 tooling/scripts/desktop-performance-sampler-gate.py",
        },
        {
            "purpose": "Re-run the final Phase 0 report gate.",
            "command": "python3 tooling/scripts/desktop-performance-report.py",
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def anchor_source_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Re-run the Desktop source anchor contract gate.",
            "command": "python3 tooling/scripts/desktop-anchor-source-gate.py",
        },
        {
            "purpose": "Collect browser/Tauri DOM anchor observations after source anchors are proven.",
            "command": normalize_review_command_text("python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py"),
        },
        {
            "purpose": "Re-run the final Phase 0 report gate.",
            "command": "python3 tooling/scripts/desktop-performance-report.py",
        },
    ]


def issue_breakdown_for_blocked_scope(scope: str, reason: str, proof_impact: str) -> list[dict[str, str]]:
    return [
        {
            "category": scope,
            "failedStep": scope,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "summary": reason,
            "proofImpact": proof_impact,
        }
    ]


def normalize_issue_breakdown_items(issues: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        normalized_issue = dict(issue)
        normalized_issue.setdefault("status", "diagnostic incomplete")
        normalized_issue["completionStatus"] = "PARTIAL"
        normalized_issue["proofStatus"] = "UNPROVEN"
        normalized_issue["sampleEmissionAllowed"] = False
        normalized.append(normalized_issue)
    return normalized


def normalize_embedded_issue_breakdowns(value: Any) -> Any:
    if isinstance(value, list):
        return [normalize_embedded_issue_breakdowns(item) for item in value]
    if not isinstance(value, dict):
        return value
    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if key in {"issue_breakdown", "issueBreakdown"} and isinstance(item, list):
            normalized[key] = normalize_issue_breakdown_items(item)
        else:
            normalized[key] = normalize_embedded_issue_breakdowns(item)
    return normalized


def preflight_state(preflight_report: dict[str, Any] | None, evidence: dict[str, Any]) -> dict[str, Any]:
    if preflight_report is None:
        reason = f"missing Desktop performance preflight report: {evidence['path']}"
        issue_breakdown = issue_breakdown_for_blocked_scope(
            "desktop-performance-preflight",
            reason,
            "P0c-1/P0c-2 remains PARTIAL/UNPROVEN until Desktop runtime preflight evidence exists.",
        )
        return {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "reason": reason,
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "phase": PREFLIGHT_REQUIRED_PHASE,
            "bom": list(PREFLIGHT_REQUIRED_BOM),
            "spec": list(PREFLIGHT_REQUIRED_SPEC),
            "gate": "Desktop runtime preflight evidence must exist before report proof is allowed",
            "artifactKind": PREFLIGHT_REQUIRED_ARTIFACT_KIND,
            "sampleEmissionAllowed": False,
            "details": ["missing preflight artifact"],
            "issue_breakdown": issue_breakdown,
            "issueBreakdown": issue_breakdown,
            "recommended_review_commands": report_review_commands(),
            "recommendedReviewCommands": report_review_commands(),
        }

    details: list[str] = []
    if preflight_report.get("artifactKind") != PREFLIGHT_REQUIRED_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if preflight_report.get("phase") != PREFLIGHT_REQUIRED_PHASE:
        details.append("missing or invalid phase")
    source_bom = preflight_report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in PREFLIGHT_REQUIRED_BOM):
        details.append("missing required preflight BOM binding")
    source_spec = preflight_report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in PREFLIGHT_REQUIRED_SPEC):
        details.append("missing required preflight Spec binding")
    if not preflight_report.get("gate"):
        details.append("missing preflight gate")
    if preflight_report.get("completionStatus") != "DONE":
        details.append("missing or incomplete completionStatus")
    if preflight_report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    if preflight_report.get("sampleEmissionAllowed") is not True:
        details.append("sample emission is not allowed")

    issue_breakdown = preflight_report.get("issue_breakdown", preflight_report.get("issueBreakdown"))
    review_commands = preflight_report.get("recommended_review_commands", preflight_report.get("recommendedReviewCommands"))
    status = "pass" if not details else "diagnostic incomplete"
    summary = preflight_report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    state: dict[str, Any] = {
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "reason": "Desktop performance preflight evidence is proven"
        if status == "pass"
        else preflight_report.get("reason") or "Desktop performance preflight evidence is incomplete",
        "evidencePath": evidence["path"],
        "evidenceStatus": evidence["status"],
        "phase": preflight_report.get("phase"),
        "bom": preflight_report.get("bom"),
        "spec": preflight_report.get("spec"),
        "gate": preflight_report.get("gate"),
        "artifactKind": preflight_report.get("artifactKind"),
        "sampleEmissionAllowed": bool(preflight_report.get("sampleEmissionAllowed")),
        "failedStep": preflight_report.get("failedStep"),
        "details": details,
    }
    for key in (
        "gateway",
        "station",
        "checkCount",
        "passedCheckCount",
        "failedCheckCount",
        "entrypointCheckCount",
        "entrypointPassedCount",
        "entrypointFailedCount",
        "stationHealthStatus",
        "desktopGatewayStatus",
        "desktopGatewayActiveStation",
        "runtimeClosureStatus",
        "runtimeClosureProofStatus",
        "runtimeClosureSampleEmissionAllowed",
        "runtimeClosureFailedStep",
        "runtimeClosureBlockedStep",
        "runtimeClosureBlockedByStep",
        "runtimeClosureBlockedDownstreamSteps",
          "runtimeClosureCheckReasons",
          "runtimeClosureFailedCheckReasons",
          "runtimeClosureLocalRuntimeClosure",
          "runtimeClosureComposeRuntimeClosure",
        "failedChecks",
    ):
        if key in preflight_report:
            state[key] = preflight_report[key]
        elif key in summary:
            state[key] = summary[key]
    if isinstance(issue_breakdown, list):
        state["issue_breakdown"] = issue_breakdown
        state["issueBreakdown"] = issue_breakdown
    if isinstance(review_commands, list):
        state["recommended_review_commands"] = review_commands
        state["recommendedReviewCommands"] = review_commands
    return state


def station_query_key(station_report: dict[str, Any] | None, evidence: dict[str, Any]) -> dict[str, Any]:
    if station_report is None:
        return {
            "source": "station-query",
            "status": evidence["status"],
            "path": evidence["path"],
            "filters": {},
        }
    return {
        "source": station_report.get("source", "station-query"),
        "status": "loaded",
        "stationUrl": station_report.get("stationUrl"),
        "filters": station_report.get("filters", {}),
        "path": evidence["path"],
    }


def station_summary(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "missing",
            "eventCount": 0,
            "rollupCount": 0,
            "maxP95DurationMs": None,
        }
    summary = station_report.get("summary", {})
    return {
        "status": "loaded",
        "eventCount": summary.get("eventCount", len(station_report.get("events", []))),
        "rollupCount": summary.get("rollupCount", len(station_report.get("rollups", []))),
        "maxP95DurationMs": summary.get("maxP95DurationMs"),
    }


def station_mirror_source_state(station_report: dict[str, Any] | None, evidence: dict[str, Any]) -> dict[str, Any]:
    if station_report is None:
        reason = f"missing Station mirror report: {evidence['path']}"
        issue_breakdown = issue_breakdown_for_blocked_scope(
            "station-mirror-source",
            reason,
            "P0a-6/P0c-5 remains PARTIAL/UNPROVEN until Station mirror source evidence exists.",
        )
        review_commands = report_review_commands()
        return {
            "status": "missing",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "reason": reason,
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "details": [],
            "issue_breakdown": issue_breakdown,
            "issueBreakdown": issue_breakdown,
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }

    details: list[str] = []
    if station_report.get("artifactKind") != MIRROR_REQUIRED_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if station_report.get("phase") != MIRROR_REQUIRED_PHASE:
        details.append("missing or invalid phase")
    source_bom = station_report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in MIRROR_REQUIRED_BOM):
        details.append("missing required mirror BOM binding")
    source_spec = station_report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in MIRROR_REQUIRED_SPEC):
        details.append("missing required mirror Spec binding")
    if not isinstance(station_report.get("gate"), str) or not station_report.get("gate"):
        details.append("missing gate")
    if station_report.get("completionStatus") != "DONE":
        details.append("missing or invalid completionStatus")
    if station_report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    if station_report.get("productSink") != MIRROR_REQUIRED_PRODUCT_SINK:
        details.append("missing Station product sink boundary")
    if station_report.get("mirrorRole") != MIRROR_REQUIRED_ROLE:
        details.append("missing Dev/CI mirror role boundary")

    status = "loaded" if not details else "diagnostic incomplete"
    source_issues = station_report.get("issue_breakdown", station_report.get("issueBreakdown"))
    source_review_commands = station_report.get(
        "recommended_review_commands",
        station_report.get("recommendedReviewCommands"),
    )
    source_details = evidence_details_from_issues(source_issues)
    is_fail_closed_template = station_report.get("source") == "station-query-template" or bool(source_issues)
    if status == "loaded":
        reason = "Station mirror source metadata is valid"
    elif is_fail_closed_template:
        reason = str(station_report.get("reason") or "Station mirror source evidence remains unproven")
        if source_details:
            details = source_details
    else:
        reason = "Station mirror source metadata is incomplete"
    state = {
        "status": status,
        "completionStatus": "DONE" if status == "loaded" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "loaded" else "UNPROVEN",
        "reason": reason,
        "evidencePath": evidence["path"],
        "evidenceStatus": evidence["status"],
        "phase": station_report.get("phase"),
        "bom": station_report.get("bom"),
        "spec": station_report.get("spec"),
        "gate": station_report.get("gate"),
        "artifactKind": station_report.get("artifactKind"),
        "productSink": station_report.get("productSink"),
        "mirrorRole": station_report.get("mirrorRole"),
        "details": details,
    }
    if status != "loaded":
        if isinstance(source_issues, list) and source_issues:
            issue_breakdown = source_issues
        else:
            issue_breakdown = issue_breakdown_for_blocked_scope(
                "station-mirror-source",
                reason,
                "P0a-6/P0c-5 remains PARTIAL/UNPROVEN until mirror source metadata is complete and proven.",
            )
        review_commands = source_review_commands if isinstance(source_review_commands, list) else report_review_commands()
        state["issue_breakdown"] = issue_breakdown
        state["issueBreakdown"] = issue_breakdown
        state["recommended_review_commands"] = review_commands
        state["recommendedReviewCommands"] = review_commands
    return state


def anchor_source_gate_state(source_report: dict[str, Any] | None, evidence: dict[str, Any]) -> dict[str, Any]:
    if source_report is None:
        reason = f"missing anchor source gate report: {evidence['path']}"
        issue_breakdown = issue_breakdown_for_blocked_scope(
            "anchor-source-gate",
            reason,
            "P0b-1 remains PARTIAL/UNPROVEN until source anchor coverage is proven before DOM automation.",
        )
        review_commands = anchor_source_review_commands()
        return {
            "status": "missing",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "reason": reason,
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "phase": ANCHOR_SOURCE_REQUIRED_PHASE,
            "bom": list(ANCHOR_SOURCE_REQUIRED_BOM),
            "spec": list(ANCHOR_SOURCE_REQUIRED_SPEC),
            "gate": ANCHOR_SOURCE_REQUIRED_GATE,
            "artifactKind": "desktop-anchor-source-gate",
            "sampleEmissionAllowed": False,
            "details": [],
            "presentCount": 0,
            "requiredCount": 0,
            "issue_breakdown": issue_breakdown,
            "issueBreakdown": issue_breakdown,
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }

    details: list[str] = []
    if source_report.get("artifactKind") != "desktop-anchor-source-gate":
        details.append("missing or invalid artifactKind")
    if source_report.get("phase") != ANCHOR_SOURCE_REQUIRED_PHASE:
        details.append("missing or invalid phase")
    source_bom = source_report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in ANCHOR_SOURCE_REQUIRED_BOM):
        details.append("missing required anchor source BOM binding")
    source_spec = source_report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in ANCHOR_SOURCE_REQUIRED_SPEC):
        details.append("missing required anchor source Spec binding")
    if not isinstance(source_report.get("gate"), str) or not source_report.get("gate"):
        details.append("missing gate")
    if source_report.get("status") != "pass":
        details.append("anchor source gate status is not pass")
    if source_report.get("completionStatus") != "DONE":
        details.append("missing or invalid completionStatus")
    if source_report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    required_count = source_report.get("requiredCount")
    present_count = source_report.get("presentCount")
    if not isinstance(required_count, int) or required_count <= 0:
        details.append("missing required anchor count")
    if not isinstance(present_count, int) or not isinstance(required_count, int) or present_count != required_count:
        details.append("source anchor present count does not match required count")

    status = "pass" if not details else "diagnostic incomplete"
    reason = "anchor source gate evidence is proven" if status == "pass" else "anchor source gate evidence is incomplete"
    source_issues = source_report.get("issue_breakdown", source_report.get("issueBreakdown"))
    if not isinstance(source_issues, list):
        source_issues = []
    source_review_commands = source_report.get("recommended_review_commands", source_report.get("recommendedReviewCommands"))
    if not isinstance(source_review_commands, list):
        source_review_commands = []
    state = {
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "reason": reason,
        "evidencePath": evidence["path"],
        "evidenceStatus": evidence["status"],
        "phase": source_report.get("phase"),
        "bom": source_report.get("bom"),
        "spec": source_report.get("spec"),
        "gate": source_report.get("gate"),
        "artifactKind": source_report.get("artifactKind"),
        "sampleEmissionAllowed": status == "pass",
        "presentCount": present_count if isinstance(present_count, int) else 0,
        "requiredCount": required_count if isinstance(required_count, int) else 0,
        "details": details,
    }
    if status != "pass":
        issue_breakdown = source_issues or issue_breakdown_for_blocked_scope(
            "anchor-source-gate",
            reason,
            "P0b-1 remains PARTIAL/UNPROVEN until source anchor coverage is proven before DOM automation.",
        )
        review_commands = source_review_commands or anchor_source_review_commands()
        state["issue_breakdown"] = issue_breakdown
        state["issueBreakdown"] = issue_breakdown
        state["recommended_review_commands"] = review_commands
        state["recommendedReviewCommands"] = review_commands
    return state


def sampler_gate_state(sampler_report: dict[str, Any] | None, evidence: dict[str, Any]) -> dict[str, Any]:
    if sampler_report is None:
        return {
            "status": "missing",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "reason": f"missing sampler gate report: {evidence['path']}",
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "details": [],
            "samplerCount": 0,
        }

    details: list[str] = []
    if sampler_report.get("artifactKind") != "desktop-performance-sampler-gate":
        details.append("missing or invalid artifactKind")
    if sampler_report.get("phase") != SAMPLER_GATE_REQUIRED_PHASE:
        details.append("missing or invalid phase")
    source_bom = sampler_report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in SAMPLER_GATE_REQUIRED_BOM):
        details.append("missing required sampler BOM binding")
    source_spec = sampler_report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in SAMPLER_GATE_REQUIRED_SPEC):
        details.append("missing required sampler Spec binding")
    if not isinstance(sampler_report.get("gate"), str) or not sampler_report.get("gate"):
        details.append("missing gate")
    if sampler_report.get("status") != "pass":
        details.append("sampler gate status is not pass")
    if sampler_report.get("completionStatus") != "DONE":
        details.append("missing or invalid completionStatus")
    if sampler_report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    if sampler_report.get("sampleEmissionAllowed") is not True:
        details.append("sample emission is not allowed")

    samplers = sampler_report.get("samplers")
    if not isinstance(samplers, list):
        samplers = []
    sampler_count = len(samplers)
    summary = sampler_report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    sampler_summaries = [
        {
            "samplerId": sampler.get("samplerId"),
            "status": sampler.get("status"),
            "completionStatus": sampler.get("completionStatus"),
            "proofStatus": sampler.get("proofStatus"),
            "phase": sampler.get("phase"),
            "bom": sampler.get("bom"),
            "spec": sampler.get("spec"),
            "gate": sampler.get("gate"),
            "requiredEventKinds": sampler.get("requiredEventKinds", []),
            "eventCount": sampler.get("eventCount"),
            "linkedEventCount": sampler.get("linkedEventCount"),
            "unlinkedEventCount": sampler.get("unlinkedEventCount"),
            "evidencePath": sampler.get("evidencePath"),
            "evidenceStatus": sampler.get("evidenceStatus"),
            "reason": sampler.get("reason"),
            "summary": sampler.get("summary", {}),
        }
        for sampler in samplers
        if isinstance(sampler, dict)
    ]
    status = "pass" if not details else "diagnostic incomplete"
    source_reason = sampler_report.get("reason")
    reason = (
        "sampler gate evidence is proven"
        if status == "pass"
        else source_reason
        if isinstance(source_reason, str) and source_reason
        else "sampler gate evidence is incomplete"
    )
    issue_breakdown = sampler_report.get("issue_breakdown", sampler_report.get("issueBreakdown"))
    review_commands = sampler_report.get("recommended_review_commands", sampler_report.get("recommendedReviewCommands"))
    state = {
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "reason": reason,
        "evidencePath": evidence["path"],
        "evidenceStatus": evidence["status"],
        "phase": sampler_report.get("phase"),
        "bom": sampler_report.get("bom"),
        "spec": sampler_report.get("spec"),
        "gate": sampler_report.get("gate"),
        "artifactKind": sampler_report.get("artifactKind"),
        "sampleEmissionAllowed": bool(sampler_report.get("sampleEmissionAllowed")),
        "samplerCount": sampler_count,
        "stationMirrorStatus": summary.get("stationMirrorStatus"),
        "stationMirrorProofStatus": summary.get("stationMirrorProofStatus"),
        "stationMirrorReason": summary.get("stationMirrorReason"),
        "provenSamplerCount": summary.get("provenSamplerCount"),
        "unprovenSamplerCount": summary.get("unprovenSamplerCount"),
        "provenSamplers": summary.get("provenSamplers", []),
        "unprovenSamplers": summary.get("unprovenSamplers", []),
        "blockedScopeCount": summary.get("blockedScopeCount"),
        "blockedScopes": summary.get("blockedScopes", []),
        "domAnchorGateStatus": summary.get("domAnchorGateStatus"),
        "domAnchorGateProofStatus": summary.get("domAnchorGateProofStatus"),
        "domAnchorBlockedBySteps": summary.get("domAnchorBlockedBySteps", []),
        "domAnchorBlockedDownstreamSteps": summary.get("domAnchorBlockedDownstreamSteps", []),
        "runtimeClosureStatus": summary.get("runtimeClosureStatus"),
        "runtimeClosureProofStatus": summary.get("runtimeClosureProofStatus"),
        "runtimeClosureSampleEmissionAllowed": summary.get("runtimeClosureSampleEmissionAllowed"),
        "runtimeClosureManagedRuntime": summary.get("runtimeClosureManagedRuntime"),
        "runtimeClosureDockerDaemonProofStatus": summary.get("runtimeClosureDockerDaemonProofStatus"),
          "runtimeClosureCheckReasons": summary.get("runtimeClosureCheckReasons") or {},
          "runtimeClosureFailedCheckReasons": summary.get("runtimeClosureFailedCheckReasons") or {},
          "runtimeClosureLocalRuntimeClosure": summary.get("runtimeClosureLocalRuntimeClosure") or {},
          "runtimeClosureComposeRuntimeClosure": summary.get("runtimeClosureComposeRuntimeClosure") or {},
        "localTelemetryBufferStatus": summary.get("localTelemetryBufferStatus"),
        "localTelemetryBufferProofStatus": summary.get("localTelemetryBufferProofStatus"),
        "localTelemetryBufferCompletionStatus": summary.get("localTelemetryBufferCompletionStatus"),
        "localTelemetryBufferSampleEmissionAllowed": summary.get("localTelemetryBufferSampleEmissionAllowed"),
        "localTelemetryBufferEventCount": summary.get("localTelemetryBufferEventCount"),
        "localTelemetryBufferDroppedCount": summary.get("localTelemetryBufferDroppedCount"),
        "localTelemetryBufferObservationSourceStatus": summary.get("localTelemetryBufferObservationSourceStatus"),
        "localTelemetryBufferObservationConsistencyStatus": summary.get(
            "localTelemetryBufferObservationConsistencyStatus"
        ),
        "localTelemetryBufferRequiredObservationFields": summary.get(
            "localTelemetryBufferRequiredObservationFields"
        )
        or [],
        "localTelemetryBufferPresentObservationFields": summary.get("localTelemetryBufferPresentObservationFields")
        or [],
        "localTelemetryBufferMissingObservationFields": summary.get("localTelemetryBufferMissingObservationFields")
        or [],
        "localTelemetryBufferObservationTemplateJsonPath": summary.get(
            "localTelemetryBufferObservationTemplateJsonPath"
        ),
        "localTelemetryBufferObservationTemplateMarkdownPath": summary.get(
            "localTelemetryBufferObservationTemplateMarkdownPath"
        ),
        "localTelemetryBufferRetentionWindowStatus": summary.get("localTelemetryBufferRetentionWindowStatus"),
        "localTelemetryBufferRetentionWindowProofStatus": summary.get("localTelemetryBufferRetentionWindowProofStatus"),
        "localTelemetryBufferRetentionWindowMaxEvents": summary.get("localTelemetryBufferRetentionWindowMaxEvents"),
        "localTelemetryBufferRetentionWindowCapacityProven": summary.get(
            "localTelemetryBufferRetentionWindowCapacityProven"
        ),
        "localTelemetryBufferRetentionWindowDroppedByKindCountSum": summary.get(
            "localTelemetryBufferRetentionWindowDroppedByKindCountSum"
        ),
        "localTelemetryBufferRetentionWindowDroppedWithInteractionCountSum": summary.get(
            "localTelemetryBufferRetentionWindowDroppedWithInteractionCountSum"
        ),
        "localTelemetryBufferRetentionWindowDroppedKindAttributionProven": summary.get(
            "localTelemetryBufferRetentionWindowDroppedKindAttributionProven"
        ),
        "localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid": summary.get(
            "localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid"
        ),
        "localTelemetryBufferRetentionWindowTotalObservedOrDroppedCount": summary.get(
            "localTelemetryBufferRetentionWindowTotalObservedOrDroppedCount"
        ),
        "localTelemetryBufferRetentionWindowDropRatio": summary.get("localTelemetryBufferRetentionWindowDropRatio"),
        "localTelemetryBufferRetentionWindowRetainedRatio": summary.get("localTelemetryBufferRetentionWindowRetainedRatio"),
        "localTelemetryBufferRetentionWindowTailWindowOnly": summary.get(
            "localTelemetryBufferRetentionWindowTailWindowOnly"
        ),
        "localTelemetryBufferFamilyPassCount": summary.get("localTelemetryBufferFamilyPassCount"),
        "localTelemetryBufferFamilyUnprovenCount": summary.get("localTelemetryBufferFamilyUnprovenCount"),
        "samplers": sampler_summaries,
        "details": details,
    }
    if isinstance(issue_breakdown, list):
        state["issue_breakdown"] = issue_breakdown
        state["issueBreakdown"] = issue_breakdown
    if isinstance(review_commands, list):
        state["recommended_review_commands"] = review_commands
        state["recommendedReviewCommands"] = review_commands
    return state


def evidence_source_trace(evidence: dict[str, Any]) -> dict[str, Any]:
    trace = {
        key: evidence[key]
        for key in (
            "sourceStatus",
            "completionStatus",
            "sourcePhase",
            "sourceBom",
            "sourceSpec",
            "sourceGate",
            "sourceArtifact",
            "sourceArtifactKind",
            "sourceCellId",
            "sourceEntrypoint",
            "sourceStartupMode",
        )
        if key in evidence
    }
    if "proofStatus" in evidence:
        trace["sourceProofStatus"] = evidence["proofStatus"]
    if isinstance(evidence.get("details"), list):
        trace["evidenceDetails"] = evidence["details"]
    issue_breakdown = evidence.get("issue_breakdown", evidence.get("issueBreakdown"))
    if isinstance(issue_breakdown, list):
        trace["issue_breakdown"] = issue_breakdown
        trace["issueBreakdown"] = issue_breakdown
    review_commands = evidence.get("recommended_review_commands", evidence.get("recommendedReviewCommands"))
    if isinstance(review_commands, list):
        trace["recommended_review_commands"] = review_commands
        trace["recommendedReviewCommands"] = review_commands
    return trace


def format_markdown_list(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(str(item) for item in value)
    if value is None:
        return "n/a"
    return str(value)


def format_red_line_sample_blockers(value: Any) -> str:
    if not isinstance(value, list) or not value:
        return "n/a"
    scopes: list[str] = []
    for item in value:
        if isinstance(item, dict) and item.get("scope"):
            scopes.append(str(item.get("scope")))
    return format_markdown_list(scopes) if scopes else "n/a"


def format_route_contracts(value: Any) -> str:
    if not isinstance(value, list):
        return "n/a"
    contracts: list[str] = []
    for contract in value:
        if not isinstance(contract, dict):
            continue
        method = contract.get("method")
        path = contract.get("path")
        if isinstance(method, str) and isinstance(path, str):
            contracts.append(f"{method} {path}")
    return ",".join(contracts) if contracts else ""


def compact_target_runtime_route_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    compact = {
        key: evidence.get(key)
        for key in (
            "sourceKind",
            "station",
            "status",
            "proofStatus",
            "versionStatus",
            "versionProofStatus",
            "version",
            "handlerTableStatus",
            "handlerTableProofStatus",
            "handlerCount",
            "registeredTelemetryRoutes",
            "missingTelemetryRoutes",
            "routeRegistrationStatus",
            "routeRegistrationProofStatus",
            "reason",
        )
        if key in evidence
    }
    probes = evidence.get("probes")
    if isinstance(probes, dict):
        compact["probeStatuses"] = {
            key: value.get("status")
            for key, value in probes.items()
            if isinstance(value, dict) and "status" in value
        }
    return compact


def normalize_local_buffer_state(local_buffer_state: Any) -> Any:
    if not isinstance(local_buffer_state, dict):
        return local_buffer_state
    normalized = dict(local_buffer_state)
    summary = normalized.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    else:
        summary = dict(summary)
    summary.setdefault(
        "sourceArtifact",
        summary.get("primaryIssueSourceArtifact") or normalized.get("sourceArtifact") or normalized.get("path"),
    )
    observation_fields = normalized.get("requiredObservationFields")
    if isinstance(observation_fields, dict):
        normalized.setdefault("requiredObservationFields", observation_fields.get("requiredFields") or [])
        normalized.setdefault("presentObservationFields", observation_fields.get("presentFields") or [])
        normalized.setdefault("missingObservationFields", observation_fields.get("missingFields") or [])
        summary.setdefault("requiredObservationFields", observation_fields.get("requiredFields") or [])
        summary.setdefault("presentObservationFields", observation_fields.get("presentFields") or [])
        summary.setdefault("missingObservationFields", observation_fields.get("missingFields") or [])
    normalized["summary"] = summary
    return normalized


def runtime_closure_blocked_reason(runtime_closure: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(runtime_closure, dict) or runtime_closure.get("sampleEmissionAllowed") is True:
        return None
    reason = (
        runtime_closure.get("reason")
        or runtime_closure.get("sourceStatus")
        or "Station runtime closure is not proven; downstream telemetry route proof is not trusted"
    )
    source_trace = evidence_source_trace(runtime_closure)
    evidence_details: list[Any] = []
    failed_check_reasons = runtime_closure.get("failedCheckReasons")
    if isinstance(failed_check_reasons, dict) and failed_check_reasons:
        evidence_details.append(
            {
                "failedStep": runtime_closure.get("failedStep") or "station-runtime-closure",
                "failedCheckReasons": failed_check_reasons,
            }
        )
    for key in ("localRuntimeClosure", "composeRuntimeClosure"):
        value = runtime_closure.get(key)
        if isinstance(value, dict):
            evidence_details.append({key: value})
    if not evidence_details:
        evidence_details = [
            {
                "status": runtime_closure.get("status"),
                "proofStatus": runtime_closure.get("proofStatus"),
                "reason": reason,
                "evidencePath": runtime_closure.get("path") or runtime_closure.get("sourceArtifact"),
                "evidenceStatus": runtime_closure.get("status"),
            }
        ]
    source_issues = runtime_closure.get("issue_breakdown", runtime_closure.get("issueBreakdown"))
    if not isinstance(source_issues, list) or not source_issues:
        source_issues = [
            {
                "category": "station-runtime-closure",
                "failedStep": runtime_closure.get("failedStep") or "station-runtime-closure",
                "summary": reason,
                "proofImpact": (
                    "P0a/P0c remains PARTIAL/UNPROVEN until managed Station+Postgres runtime "
                    "closure is proven before route, upload, query, rollup, mirror, or samples."
                ),
            }
        ]
    review_commands = runtime_closure.get("recommended_review_commands", runtime_closure.get("recommendedReviewCommands"))
    if not isinstance(review_commands, list):
        review_commands = report_review_commands()
    return {
        "scope": "station-runtime-closure",
        "status": runtime_closure.get("status"),
        "proofStatus": runtime_closure.get("proofStatus"),
        "reason": reason,
        "evidencePath": runtime_closure.get("path") or runtime_closure.get("sourceArtifact"),
        "evidenceStatus": runtime_closure.get("status"),
        "sampleEmissionAllowed": bool(runtime_closure.get("sampleEmissionAllowed")),
        **source_trace,
        "failedCheckReasons": failed_check_reasons,
        "localRuntimeClosure": runtime_closure.get("localRuntimeClosure"),
        "composeRuntimeClosure": runtime_closure.get("composeRuntimeClosure"),
        "blockedDownstreamSteps": runtime_closure.get("blockedDownstreamSteps"),
        "blockedDownstreamProofs": runtime_closure.get("blockedDownstreamProofs") or [],
        "evidenceDetails": evidence_details,
        "issue_breakdown": source_issues,
        "issueBreakdown": source_issues,
        "recommended_review_commands": review_commands,
        "recommendedReviewCommands": review_commands,
    }


def blocked_reasons(matrix_report: dict[str, Any] | None, matrix_evidence: dict[str, Any]) -> list[dict[str, Any]]:
    if matrix_report is None:
        return [
            {
                "scope": "matrix",
                "status": "diagnostic incomplete",
                "proofStatus": "UNPROVEN",
                "reason": f"missing matrix report: {matrix_evidence['path']}",
                "evidencePath": matrix_evidence["path"],
                "evidenceStatus": matrix_evidence["status"],
                "sampleEmissionAllowed": False,
            }
        ]
    reasons: list[dict[str, Any]] = []
    runtime_closure = matrix_report.get("stationTelemetryRuntimeClosureState")
    if isinstance(runtime_closure, dict):
        runtime_closure_reason = runtime_closure_blocked_reason(runtime_closure)
        if runtime_closure_reason is not None:
            reasons.append(runtime_closure_reason)
    route_probe = matrix_report.get("stationTelemetryRouteProbeState")
    if isinstance(route_probe, dict) and route_probe.get("sampleEmissionAllowed") is not True:
        reason = (
            route_probe.get("reason")
            or route_probe.get("sourceStatus")
            or "Station telemetry route capability evidence is not proven"
        )
        source_trace = evidence_source_trace(route_probe)
        evidence_details = route_probe.get("evidenceDetails", route_probe.get("details"))
        if not isinstance(evidence_details, list) or not evidence_details:
            evidence_details = [
                {
                    "status": route_probe.get("status"),
                    "proofStatus": route_probe.get("proofStatus"),
                    "reason": reason,
                    "evidencePath": route_probe.get("path"),
                    "evidenceStatus": route_probe.get("status"),
                }
            ]
        source_issues = route_probe.get("issue_breakdown", route_probe.get("issueBreakdown"))
        if not isinstance(source_issues, list):
            source_issues = []
        review_commands = route_probe.get("recommended_review_commands", route_probe.get("recommendedReviewCommands"))
        if not isinstance(review_commands, list):
            review_commands = report_review_commands()
        extended_source: dict[str, Any] = {}
        for key in (
            "environmentClassification",
            "localSourceRouteEvidence",
            "localSourceDeploymentEvidence",
            "targetRuntimeRouteEvidence",
            "runtimeClosureEvidence",
              "runtimeClosureProofStatus",
              "runtimeClosureSampleEmissionAllowed",
              "runtimeClosureDockerDaemonProofStatus",
              "runtimeClosureFailedCheckReasons",
              "runtimeClosureLocalRuntimeClosure",
              "runtimeClosureComposeRuntimeClosure",
              "routeTrustBlockedProofs",
              "routeTrustBlockedProofCount",
        ):
            value = route_probe.get(key)
            if value is not None:
                extended_source[key] = value
        reasons.append(
            {
                "scope": "station-telemetry-route-probe",
                "status": route_probe.get("status"),
                "proofStatus": route_probe.get("proofStatus"),
                "reason": reason,
                "evidencePath": route_probe.get("path"),
                "evidenceStatus": route_probe.get("status"),
                "sampleEmissionAllowed": bool(route_probe.get("sampleEmissionAllowed")),
                **source_trace,
                **extended_source,
                "evidenceDetails": evidence_details,
                "issue_breakdown": source_issues,
                "issueBreakdown": source_issues,
                "recommended_review_commands": review_commands,
                "recommendedReviewCommands": review_commands,
            }
        )
    for cell in matrix_report.get("cells", []):
        if not cell.get("sampleEmissionAllowed"):
            evidence = cell.get("evidence", {})
            evidence_reason = None
            source_trace: dict[str, Any] = {}
            evidence_details: list[Any] = []
            source_issues: list[Any] = []
            review_commands: list[Any] = report_review_commands()
            if isinstance(evidence, dict):
                evidence_reason = evidence.get("reason") or evidence.get("error") or evidence.get("sourceStatus")
                source_trace = evidence_source_trace(evidence)
                details = evidence.get("evidenceDetails", evidence.get("details", evidence.get("validationDetails")))
                if isinstance(details, list):
                    evidence_details = details
                source_issue_breakdown = evidence.get("issue_breakdown", evidence.get("issueBreakdown"))
                if isinstance(source_issue_breakdown, list):
                    source_issues = source_issue_breakdown
                commands = evidence.get("recommended_review_commands", evidence.get("recommendedReviewCommands"))
                if isinstance(commands, list):
                    review_commands = commands
                for key in (
                    "environmentClassification",
                    "localSourceRouteEvidence",
                    "localSourceDeploymentEvidence",
                    "targetRuntimeRouteEvidence",
                    "runtimeClosureEvidence",
                ):
                    value = evidence.get(key)
                    if value is not None:
                        source_trace[key] = value
            if not evidence_details:
                evidence_details = [
                    {
                        "status": cell.get("status"),
                        "proofStatus": cell.get("proofStatus"),
                        "reason": evidence_reason
                        or cell.get("reason")
                        or "sample emission is not allowed for this matrix cell",
                        "evidencePath": evidence.get("path") if isinstance(evidence, dict) else None,
                        "evidenceStatus": evidence.get("status") if isinstance(evidence, dict) else None,
                    }
                ]
            reasons.append(
                {
                    "scope": f"matrix:{cell.get('cellId')}",
                    "status": cell.get("status"),
                    "proofStatus": cell.get("proofStatus"),
                    "reason": evidence_reason
                    or cell.get("reason")
                    or "sample emission is not allowed for this matrix cell",
                    "matrixReason": cell.get("reason"),
                    "evidencePath": evidence.get("path") if isinstance(evidence, dict) else None,
                    "evidenceStatus": evidence.get("status") if isinstance(evidence, dict) else None,
                    "sampleEmissionAllowed": bool(cell.get("sampleEmissionAllowed")),
                    **source_trace,
                    "evidenceDetails": evidence_details,
                    "issue_breakdown": source_issues,
                    "issueBreakdown": source_issues,
                    "recommended_review_commands": review_commands,
                    "recommendedReviewCommands": review_commands,
                }
            )
    red_lines = matrix_report.get("redLinePolicy", {})
    for policy in red_lines.get("policies", []):
        if policy.get("status") != "pass":
            raw_evidence = policy.get("rawEvidence", {})
            source_trace = evidence_source_trace(raw_evidence) if isinstance(raw_evidence, dict) else {}
            scope = f"red-line:{policy.get('policyId')}"
            reason = policy.get("reason") or "red-line policy evidence is not proven"
            raw_evidence_details = raw_evidence.get("details") if isinstance(raw_evidence, dict) else None
            sample_blockers = policy.get("sampleBlockers") if isinstance(policy.get("sampleBlockers"), list) else []
            evidence_detail: dict[str, Any] = {
                "policyId": policy.get("policyId"),
                "status": policy.get("status"),
                "proofStatus": policy.get("proofStatus"),
                "reason": reason,
                "evidencePath": raw_evidence.get("path") if isinstance(raw_evidence, dict) else None,
                "evidenceStatus": raw_evidence.get("status") if isinstance(raw_evidence, dict) else None,
            }
            if sample_blockers:
                evidence_detail["sampleBlockers"] = sample_blockers
            if isinstance(raw_evidence_details, list) and raw_evidence_details:
                evidence_detail["rawEvidenceDetails"] = raw_evidence_details
            if isinstance(raw_evidence, dict):
                evidence_detail["rawEvidence"] = raw_evidence
            evidence_details = [evidence_detail]
            issue_breakdown = issue_breakdown_for_blocked_scope(
                scope,
                reason,
                "P0c-5 remains PARTIAL/UNPROVEN until sampled red-line evidence is present and evaluated.",
            )
            if sample_blockers:
                for issue in issue_breakdown:
                    if isinstance(issue, dict):
                        issue["sampleBlockers"] = sample_blockers
            review_commands = report_review_commands()
            reasons.append(
                {
                    "scope": scope,
                    "status": policy.get("status"),
                    "proofStatus": policy.get("proofStatus"),
                    "reason": reason,
                    "evidencePath": raw_evidence.get("path") if isinstance(raw_evidence, dict) else None,
                    "evidenceStatus": raw_evidence.get("status") if isinstance(raw_evidence, dict) else None,
                    "sampleEmissionAllowed": False,
                    **source_trace,
                    "sampleBlockers": sample_blockers,
                    "evidenceDetails": evidence_details,
                    "issue_breakdown": issue_breakdown,
                    "issueBreakdown": issue_breakdown,
                    "recommended_review_commands": review_commands,
                    "recommendedReviewCommands": review_commands,
                }
            )
    return reasons


def aggregation_blocked_reason(
    aggregation_key: str,
    aggregation: dict[str, Any],
    station_evidence: dict[str, Any],
    station_source: dict[str, Any],
) -> dict[str, Any] | None:
    if aggregation.get("status") == "loaded":
        return None
    trace = AGGREGATION_TRACE[aggregation_key]
    reason = aggregation.get("reason", "aggregation evidence is not proven")
    issue_breakdown = issue_breakdown_for_blocked_scope(
        trace["scope"],
        reason,
        f"{trace['phase']} remains PARTIAL/UNPROVEN until Station mirror contains this sampler evidence.",
    )
    review_commands = report_review_commands()
    evidence_details = [
        {
            "aggregationKey": aggregation_key,
            "status": aggregation.get("status", "diagnostic incomplete"),
            "proofStatus": aggregation.get("proofStatus", "UNPROVEN"),
            "reason": reason,
            "evidencePath": station_evidence["path"],
            "evidenceStatus": station_evidence["status"],
        }
    ]
    return {
        "scope": trace["scope"],
        "status": aggregation.get("status", "diagnostic incomplete"),
        "proofStatus": aggregation.get("proofStatus", "UNPROVEN"),
        "reason": reason,
        "evidencePath": station_evidence["path"],
        "evidenceStatus": station_evidence["status"],
        "sourceArtifact": station_evidence["path"],
        "sourceArtifactKind": station_source.get("artifactKind") or MIRROR_REQUIRED_ARTIFACT_KIND,
        "sourcePhase": trace["phase"],
        "sourceBom": trace["bom"],
        "sourceSpec": trace["spec"],
        "sourceGate": trace["gate"],
        "completionStatus": station_source.get("completionStatus", "PARTIAL"),
        "sourceProofStatus": station_source.get("proofStatus", "UNPROVEN"),
        "sampleEmissionAllowed": False,
        "evidenceDetails": evidence_details,
        "issue_breakdown": issue_breakdown,
        "issueBreakdown": issue_breakdown,
        "recommended_review_commands": review_commands,
        "recommendedReviewCommands": review_commands,
    }


def normalize_blocked_reasons(blocked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in blocked:
        reason = dict(item)
        reason["sampleEmissionAllowed"] = False
        reason.setdefault("completionStatus", "PARTIAL")
        reason.setdefault("proofStatus", reason.get("sourceProofStatus") or "UNPROVEN")
        normalized.append(reason)
    return normalized


def report_issue_breakdown(blocked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for item in blocked:
        source_artifact = item.get("sourceArtifact")
        source_artifact_kind = item.get("sourceArtifactKind")
        evidence_details = item.get("evidenceDetails")
        review_commands = item.get("recommended_review_commands", item.get("recommendedReviewCommands"))
        source_trace = {
            key: item[key]
            for key in ("sourcePhase", "sourceBom", "sourceSpec", "sourceGate")
            if key in item
        }
        source_issues = item.get("issue_breakdown", item.get("issueBreakdown"))
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if isinstance(issue, dict):
                    issue_details = issue.get("evidenceDetails", issue.get("details", evidence_details))
                    issue_commands = issue.get(
                        "recommendedReviewCommands",
                        issue.get("recommended_review_commands", review_commands),
                    )
                    report_issue: dict[str, Any] = {
                        "category": str(issue.get("category") or item.get("scope") or "blocked-reason"),
                        "failedStep": str(issue.get("failedStep") or item.get("scope") or "unknown"),
                        "status": str(issue.get("status") or item.get("status") or item.get("sourceStatus") or "diagnostic incomplete"),
                        "completionStatus": str(issue.get("completionStatus") or item.get("completionStatus") or "PARTIAL"),
                        "proofStatus": str(
                            issue.get("proofStatus")
                            or item.get("proofStatus")
                            or item.get("sourceProofStatus")
                            or "UNPROVEN"
                        ),
                        "sampleEmissionAllowed": bool(issue.get("sampleEmissionAllowed"))
                        if isinstance(issue.get("sampleEmissionAllowed"), bool)
                        else bool(item.get("sampleEmissionAllowed"))
                        if isinstance(item.get("sampleEmissionAllowed"), bool)
                        else False,
                        "summary": str(issue.get("summary") or item.get("reason") or "blocked reason is not proven"),
                        "proofImpact": str(
                            issue.get("proofImpact")
                            or "P0c report remains PARTIAL/UNPROVEN until this blocked reason is resolved."
                        ),
                    }
                    if isinstance(source_artifact, str):
                        report_issue["sourceArtifact"] = issue.get("sourceArtifact", source_artifact)
                    if isinstance(source_artifact_kind, str):
                        report_issue["sourceArtifactKind"] = issue.get("sourceArtifactKind", source_artifact_kind)
                    report_issue.update(
                        {
                            key: issue.get(key, value)
                            for key, value in source_trace.items()
                        }
                    )
                    for key in (
                        "environmentClassification",
                        "localSourceRouteEvidence",
                        "localSourceDeploymentEvidence",
                        "targetRuntimeRouteEvidence",
                        "runtimeClosureEvidence",
                    ):
                        value = issue.get(key, item.get(key))
                        if value is not None:
                            report_issue[key] = value
                    if isinstance(issue_details, list):
                        report_issue["evidenceDetails"] = issue_details
                    if isinstance(issue_commands, list):
                        report_issue["recommended_review_commands"] = issue_commands
                        report_issue["recommendedReviewCommands"] = issue_commands
                    issues.append(report_issue)
            continue
        report_issue = {
            "category": str(item.get("scope") or "blocked-reason"),
            "failedStep": str(item.get("scope") or "unknown"),
            "status": str(item.get("status") or item.get("sourceStatus") or "diagnostic incomplete"),
            "completionStatus": str(item.get("completionStatus") or "PARTIAL"),
            "proofStatus": str(item.get("proofStatus") or item.get("sourceProofStatus") or "UNPROVEN"),
            "sampleEmissionAllowed": bool(item.get("sampleEmissionAllowed"))
            if isinstance(item.get("sampleEmissionAllowed"), bool)
            else False,
            "summary": str(item.get("reason") or "blocked reason is not proven"),
            "proofImpact": "P0c report remains PARTIAL/UNPROVEN until this blocked reason is resolved.",
        }
        if isinstance(source_artifact, str):
            report_issue["sourceArtifact"] = source_artifact
        if isinstance(source_artifact_kind, str):
            report_issue["sourceArtifactKind"] = source_artifact_kind
        report_issue.update(source_trace)
        if isinstance(evidence_details, list):
            report_issue["evidenceDetails"] = evidence_details
        if isinstance(review_commands, list):
            report_issue["recommended_review_commands"] = review_commands
            report_issue["recommendedReviewCommands"] = review_commands
        issues.append(report_issue)
    return issues


def normalize_review_command_text(command_text: str) -> str:
    collect = "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py"
    observations = "--observations <desktop-anchor-dom-observations.json>"
    output = "--output <desktop-anchor-dom-evidence.json>"
    if command_text.startswith(collect):
        return f"{collect} {observations} {output}"
    return command_text


def report_recommended_review_commands(blocked: list[dict[str, Any]]) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in blocked:
        source_commands = item.get("recommended_review_commands", item.get("recommendedReviewCommands"))
        if not isinstance(source_commands, list):
            continue
        for command in source_commands:
            if not isinstance(command, dict):
                continue
            purpose = command.get("purpose")
            command_text = command.get("command")
            if not isinstance(purpose, str) or not isinstance(command_text, str):
                continue
            command_text = normalize_review_command_text(command_text)
            key = command_text
            if key in seen:
                continue
            seen.add(key)
            commands.append({"purpose": purpose, "command": command_text})
    if commands:
        return commands
    return report_review_commands()


def primary_issue_summary(issues: list[dict[str, Any]]) -> dict[str, Any]:
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        result: dict[str, Any] = {}
        failed_step = issue.get("failedStep")
        summary = issue.get("summary")
        if isinstance(failed_step, str) and failed_step:
            result["failedStep"] = failed_step
        if isinstance(summary, str) and summary:
            result["reason"] = summary
        for key in ("category", "sourceArtifact", "sourceArtifactKind", "sourcePhase", "sourceBom", "sourceSpec", "sourceGate"):
            value = issue.get(key)
            if value is not None:
                result[f"primaryIssue{key[0].upper()}{key[1:]}"] = value
        if result:
            return result
    return {}


def report_summary(report: dict[str, Any]) -> dict[str, Any]:
    matrix = report.get("matrix")
    if not isinstance(matrix, dict):
        matrix = {}
    red_line = report.get("redLineState")
    if not isinstance(red_line, dict):
        red_line = {}
    route_probe = matrix.get("stationTelemetryRouteProbeState")
    if not isinstance(route_probe, dict):
        route_probe = {}
    browser_gateway_live_evidence: dict[str, Any] = {}
    for cell in matrix.get("cells", []):
        if not isinstance(cell, dict) or cell.get("cellId") != "browser-gateway":
            continue
        evidence = cell.get("evidence")
        if isinstance(evidence, dict):
            browser_gateway_live_evidence = evidence
            break
    route_source = route_probe if route_probe.get("sourceArtifactKind") else browser_gateway_live_evidence
    db_schema = matrix.get("stationTelemetryDbSchemaState")
    if not isinstance(db_schema, dict):
        db_schema = {}
    local_loop = matrix.get("stationTelemetryLocalLoopState")
    if not isinstance(local_loop, dict):
        local_loop = {}
    runtime_closure = matrix.get("stationTelemetryRuntimeClosureState")
    if not isinstance(runtime_closure, dict):
        runtime_closure = {}
    local_buffer = matrix.get("localTelemetryBufferState")
    if not isinstance(local_buffer, dict):
        local_buffer = {}
    sampler_gate = report.get("samplerGate") if isinstance(report.get("samplerGate"), dict) else {}
    if not local_buffer and sampler_gate:
        local_buffer = {
            "status": sampler_gate.get("localTelemetryBufferStatus"),
            "proofStatus": sampler_gate.get("localTelemetryBufferProofStatus"),
            "sampleEmissionAllowed": sampler_gate.get("localTelemetryBufferSampleEmissionAllowed"),
            "requiredObservationFields": sampler_gate.get("localTelemetryBufferRequiredObservationFields") or [],
            "presentObservationFields": sampler_gate.get("localTelemetryBufferPresentObservationFields") or [],
            "missingObservationFields": sampler_gate.get("localTelemetryBufferMissingObservationFields") or [],
            "observationTemplateJsonPath": sampler_gate.get("localTelemetryBufferObservationTemplateJsonPath"),
            "observationTemplateMarkdownPath": sampler_gate.get("localTelemetryBufferObservationTemplateMarkdownPath"),
        }
    route_environment_classification = route_probe.get("environmentClassification")
    if route_environment_classification is None:
        route_issues = route_probe.get("issueBreakdown", route_probe.get("issue_breakdown"))
        if isinstance(route_issues, list):
            for issue in route_issues:
                if isinstance(issue, dict) and issue.get("environmentClassification"):
                    route_environment_classification = issue.get("environmentClassification")
                    break
    local_route_evidence = route_probe.get("localSourceRouteEvidence")
    if not isinstance(local_route_evidence, dict):
        local_route_evidence = {}
    target_route_evidence = route_probe.get("targetRuntimeRouteEvidence")
    if not isinstance(target_route_evidence, dict):
        target_route_evidence = {}
    local_registered_routes = route_probe.get("localSourceRegisteredRoutes")
    if not isinstance(local_registered_routes, list):
        local_registered_routes = local_route_evidence.get("registeredRoutes")
    if not isinstance(local_registered_routes, list):
        local_registered_routes = []
    target_registered_routes = route_probe.get("targetRuntimeRegisteredRoutes")
    if not isinstance(target_registered_routes, list):
        target_registered_routes = target_route_evidence.get("registeredTelemetryRoutes")
    if not isinstance(target_registered_routes, list):
        target_registered_routes = []
    target_missing_routes = route_probe.get("targetRuntimeMissingRoutes")
    if not isinstance(target_missing_routes, list):
        target_missing_routes = target_route_evidence.get("missingTelemetryRoutes")
    if not isinstance(target_missing_routes, list):
        target_missing_routes = []
    required_routes = route_probe.get("requiredRoutes")
    if not isinstance(required_routes, list):
        required_routes = list(dict.fromkeys([str(route) for route in local_registered_routes + target_missing_routes]))
    probed_routes = route_probe.get("probedRoutes")
    if not isinstance(probed_routes, list):
        probed_routes = []
    local_source_proof_status = route_probe.get("localSourceProofStatus", local_route_evidence.get("proofStatus"))
    local_source_missing_route_count = route_probe.get("localSourceMissingRouteCount")
    if local_source_missing_route_count is None and required_routes:
        local_source_missing_route_count = max(0, len(required_routes) - len(local_registered_routes))
    local_source_status = route_probe.get("localSourceStatus")
    if local_source_status is None and local_source_proof_status == "PROVEN" and local_source_missing_route_count == 0:
        local_source_status = "pass"
    target_runtime_proof_status = route_probe.get("targetRuntimeProofStatus", target_route_evidence.get("proofStatus"))
    target_runtime_status = route_probe.get("targetRuntimeStatus")
    target_runtime_version_fingerprint = route_probe.get(
        "targetRuntimeVersionFingerprint",
        target_route_evidence.get("versionFingerprint"),
    )
    target_runtime_identity = route_probe.get(
        "targetRuntimeIdentity",
        target_route_evidence.get("identity"),
    )
    if target_runtime_status is None and target_runtime_proof_status == "PROVEN":
        target_runtime_status = "pass"
    browser_gateway_preflight = matrix.get("browserGatewayPreflightState")
    if not isinstance(browser_gateway_preflight, dict):
        browser_gateway_preflight = {}
    browser_gateway_dom = matrix.get("browserGatewayDomEvidenceState")
    if not isinstance(browser_gateway_dom, dict):
        browser_gateway_dom = {}
    matrix_summary = matrix.get("summary")
    if not isinstance(matrix_summary, dict):
        matrix_summary = {}
    fail_closed = matrix.get("failClosed")
    if not isinstance(fail_closed, dict):
        fail_closed = {}
    matrix_cells = matrix.get("cells")
    if not isinstance(matrix_cells, list):
        matrix_cells = []
    runtime_cell_details: list[dict[str, Any]] = []
    for cell in matrix_cells:
        if not isinstance(cell, dict):
            continue
        evidence = cell.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        details = evidence.get("validationDetails", evidence.get("details"))
        if not isinstance(details, list):
            details = []
        cell_summary = evidence.get("summary")
        if not isinstance(cell_summary, dict):
            cell_summary = {}
        runtime_cell_details.append(
            {
                "cellId": cell.get("cellId"),
                "status": cell.get("status"),
                "proofStatus": cell.get("proofStatus"),
                "sampleEmissionAllowed": bool(cell.get("sampleEmissionAllowed")),
                "failedStep": evidence.get("failedStep"),
                "details": details,
                "sourceCellId": evidence.get("sourceCellId"),
                "sourceEntrypoint": evidence.get("sourceEntrypoint"),
                "sourceStartupMode": evidence.get("sourceStartupMode"),
                "observationSourceStatus": cell_summary.get("observationSourceStatus"),
                "observationSourcePath": cell_summary.get("observationSourcePath"),
                "readyShellProofStatus": cell_summary.get("readyShellProofStatus"),
                "telemetryProofStatus": cell_summary.get("telemetryProofStatus"),
                "telemetryEventCount": cell_summary.get("telemetryEventCount"),
                "telemetryInteractionIdCount": cell_summary.get("telemetryInteractionIdCount"),
                "validationDetailCount": cell_summary.get("validationDetailCount"),
            }
        )
    blocked = report.get("blockedReasons")
    if not isinstance(blocked, list):
        blocked = []
    issues = report.get("issueBreakdown", report.get("issue_breakdown"))
    if not isinstance(issues, list):
        issues = []
    blocked_scopes = [str(item.get("scope")) for item in blocked if isinstance(item, dict) and item.get("scope")]
    unproven_states = {
        "preflight": report.get("preflightState"),
        "stationMirrorSource": report.get("stationMirrorSource"),
        "matrix": matrix,
        "stationTelemetryRuntimeClosure": runtime_closure,
        "anchorSourceGate": report.get("anchorSourceGate"),
        "anchorInventory": report.get("anchorInventory"),
        "anchorDomEvidenceGate": report.get("anchorDomEvidenceGate"),
        "samplerGate": report.get("samplerGate"),
        "redLineState": red_line,
        "reactCommitAggregation": report.get("reactCommitAggregation"),
        "storeUpdateAggregation": report.get("storeUpdateAggregation"),
        "overlayLatencyAggregation": report.get("overlayLatencyAggregation"),
        "invokeAggregation": report.get("invokeAggregation"),
        "mainThreadExceptions": report.get("mainThreadExceptions"),
        "interactionCorrelation": report.get("interactionCorrelation"),
    }
    unproven_scopes = [
        scope
        for scope, state in unproven_states.items()
        if isinstance(state, dict) and state.get("proofStatus") != "PROVEN"
    ]
    anchor_inventory = report.get("anchorInventory")
    if not isinstance(anchor_inventory, dict):
        anchor_inventory = {}
    anchor_inventory_source = anchor_inventory.get("sourceAnchors")
    if not isinstance(anchor_inventory_source, dict):
        anchor_inventory_source = {}
    anchor_inventory_dom = anchor_inventory.get("domAutomation")
    if not isinstance(anchor_inventory_dom, dict):
        anchor_inventory_dom = {}
    anchor_inventory_browser = anchor_inventory_dom.get("browser")
    if not isinstance(anchor_inventory_browser, dict):
        anchor_inventory_browser = {}
    anchor_inventory_tauri = anchor_inventory_dom.get("tauri")
    if not isinstance(anchor_inventory_tauri, dict):
        anchor_inventory_tauri = {}
    anchor_dom_gate = report.get("anchorDomEvidenceGate")
    if not isinstance(anchor_dom_gate, dict):
        anchor_dom_gate = {}
    anchor_dom_summary = anchor_dom_gate.get("summary")
    if not isinstance(anchor_dom_summary, dict):
        anchor_dom_summary = {}
    anchor_dom = anchor_dom_gate.get("domAutomation")
    if not isinstance(anchor_dom, dict):
        anchor_dom = {}
    anchor_dom_browser = anchor_dom.get("browser")
    if not isinstance(anchor_dom_browser, dict):
        anchor_dom_browser = {}
    anchor_dom_tauri = anchor_dom.get("tauri")
    if not isinstance(anchor_dom_tauri, dict):
        anchor_dom_tauri = {}
    return {
        "status": report.get("status"),
        "completionStatus": report.get("completionStatus"),
        "proofStatus": report.get("proofStatus"),
        "sampleEmissionAllowed": report.get("status") == "pass",
        "blockedReasonCount": len(blocked),
        "issueCount": len(issues),
        "blockedScopes": blocked_scopes,
        "unprovenScopeCount": len(unproven_scopes),
        "unprovenScopes": unproven_scopes,
        "stationMirrorStatus": report.get("stationMirror", {}).get("status")
        if isinstance(report.get("stationMirror"), dict)
        else None,
        "stationMirrorEventCount": report.get("stationMirror", {}).get("eventCount", 0)
        if isinstance(report.get("stationMirror"), dict)
        else 0,
        "stationMirrorRollupCount": report.get("stationMirror", {}).get("rollupCount", 0)
        if isinstance(report.get("stationMirror"), dict)
        else 0,
        "stationMirrorSourceStatus": report.get("stationMirrorSource", {}).get("status")
        if isinstance(report.get("stationMirrorSource"), dict)
        else None,
        "preflightStatus": report.get("preflightState", {}).get("status")
        if isinstance(report.get("preflightState"), dict)
        else None,
        "preflightSampleEmissionAllowed": report.get("preflightState", {}).get("sampleEmissionAllowed")
        if isinstance(report.get("preflightState"), dict)
        else None,
        "appGatewayPreflightStatus": matrix_summary.get("appGatewayPreflightStatus"),
        "appGatewayPreflightProofStatus": matrix_summary.get("appGatewayPreflightProofStatus"),
        "appGatewayPreflightFailedStep": matrix_summary.get("appGatewayPreflightFailedStep"),
        "appGatewayPreflightGateway": matrix_summary.get("appGatewayPreflightGateway"),
        "appGatewayPreflightStation": matrix_summary.get("appGatewayPreflightStation"),
        "appGatewayPreflightCheckCount": matrix_summary.get("appGatewayPreflightCheckCount"),
        "appGatewayPreflightPassedCheckCount": matrix_summary.get("appGatewayPreflightPassedCheckCount"),
        "appGatewayPreflightFailedCheckCount": matrix_summary.get("appGatewayPreflightFailedCheckCount"),
        "appGatewayPreflightStationHealthStatus": matrix_summary.get("appGatewayPreflightStationHealthStatus"),
        "appGatewayPreflightDesktopGatewayStatus": matrix_summary.get("appGatewayPreflightDesktopGatewayStatus"),
        "appGatewayPreflightRuntimeClosureStatus": matrix_summary.get("appGatewayPreflightRuntimeClosureStatus"),
        "appGatewayPreflightRuntimeClosureProofStatus": matrix_summary.get(
            "appGatewayPreflightRuntimeClosureProofStatus"
        ),
        "appGatewayPreflightRuntimeClosureSampleEmissionAllowed": matrix_summary.get(
            "appGatewayPreflightRuntimeClosureSampleEmissionAllowed"
        ),
        "appGatewayPreflightRuntimeClosureFailedStep": matrix_summary.get(
            "appGatewayPreflightRuntimeClosureFailedStep"
        ),
        "appGatewayPreflightRuntimeClosureBlockedStep": matrix_summary.get(
            "appGatewayPreflightRuntimeClosureBlockedStep"
        ),
        "appGatewayPreflightRuntimeClosureBlockedByStep": matrix_summary.get(
            "appGatewayPreflightRuntimeClosureBlockedByStep"
        ),
        "appGatewayPreflightRuntimeClosureBlockedDownstreamSteps": matrix_summary.get(
            "appGatewayPreflightRuntimeClosureBlockedDownstreamSteps"
        )
        or [],
          "appGatewayPreflightRuntimeClosureCheckReasons": matrix_summary.get(
              "appGatewayPreflightRuntimeClosureCheckReasons"
          )
          or {},
          "appGatewayPreflightRuntimeClosureFailedCheckReasons": matrix_summary.get(
              "appGatewayPreflightRuntimeClosureFailedCheckReasons"
          )
          or {},
          "appGatewayPreflightRuntimeClosureLocalRuntimeClosure": matrix_summary.get(
              "appGatewayPreflightRuntimeClosureLocalRuntimeClosure"
          )
          or {},
          "appGatewayPreflightRuntimeClosureComposeRuntimeClosure": matrix_summary.get(
              "appGatewayPreflightRuntimeClosureComposeRuntimeClosure"
          )
          or {},
        "appGatewayPreflightFailedChecks": matrix_summary.get("appGatewayPreflightFailedChecks"),
        "matrixStatus": matrix.get("status"),
        "matrixSampledCells": matrix_summary.get("sampled", 0),
        "matrixBlockedCells": fail_closed.get("blockedCellCount", 0),
        "matrixDiagnosticIncompleteCells": sum(
            1 for detail in runtime_cell_details if detail.get("status") == "diagnostic incomplete"
        ),
        "matrixUnprovenRuntimeCells": sum(
            1 for detail in runtime_cell_details if detail.get("proofStatus") != "PROVEN"
        ),
        "matrixRuntimeCellDetails": runtime_cell_details,
        "stationTelemetryRouteProbeStatus": route_probe.get("status"),
          "stationTelemetryRouteProbeSourceStatus": route_probe.get("sourceStatus"),
        "stationTelemetryRouteProbeProofStatus": route_probe.get("proofStatus"),
          "stationTelemetryRouteProbeCompletionStatus": route_probe.get("completionStatus"),
          "stationTelemetryRouteProbeSampleEmissionAllowed": route_probe.get("sampleEmissionAllowed"),
          "stationTelemetryRouteEvidenceSourceArtifact": route_source.get("sourceArtifact") or route_source.get("path"),
          "stationTelemetryRouteEvidenceSourceKind": route_source.get("sourceArtifactKind"),
          "stationTelemetryRouteEvidenceSourcePhase": route_source.get("sourcePhase"),
          "stationTelemetryRouteEvidenceSourceBom": route_source.get("sourceBom"),
          "stationTelemetryRouteEvidenceSourceSpec": route_source.get("sourceSpec"),
          "stationTelemetryRouteEvidenceSourceGate": route_source.get("sourceGate"),
          "stationTelemetryRouteEvidenceSourceReason": route_source.get("reason"),
        "stationTelemetryRouteProofTrusted": route_probe.get("routeProofTrusted"),
          "stationTelemetryRouteTrustBlockedProofs": route_probe.get("routeTrustBlockedProofs") or [],
          "stationTelemetryRouteTrustBlockedProofCount": len(route_probe.get("routeTrustBlockedProofs") or []),
        "stationTelemetryRouteRuntimeClosureProofStatus": route_probe.get("runtimeClosureProofStatus"),
        "stationTelemetryRouteRuntimeClosureSampleEmissionAllowed": route_probe.get(
            "runtimeClosureSampleEmissionAllowed"
        ),
        "stationTelemetryRouteRuntimeClosureDockerDaemonProofStatus": route_probe.get(
            "runtimeClosureDockerDaemonProofStatus"
        ),
          "stationTelemetryRouteRuntimeClosureCheckReasons": route_probe.get("runtimeClosureCheckReasons")
          or matrix_summary.get("stationTelemetryRouteRuntimeClosureCheckReasons")
          or {},
          "stationTelemetryRouteRuntimeClosureFailedCheckReasons": route_probe.get(
              "runtimeClosureFailedCheckReasons"
          )
          or matrix_summary.get("stationTelemetryRouteRuntimeClosureFailedCheckReasons")
          or {},
          "stationTelemetryRouteRuntimeClosureLocalRuntimeClosure": route_probe.get(
              "runtimeClosureLocalRuntimeClosure"
          )
          or matrix_summary.get("stationTelemetryRouteRuntimeClosureLocalRuntimeClosure")
          or {},
          "stationTelemetryRouteRuntimeClosureComposeRuntimeClosure": route_probe.get(
              "runtimeClosureComposeRuntimeClosure"
          )
          or matrix_summary.get("stationTelemetryRouteRuntimeClosureComposeRuntimeClosure")
          or {},
        "stationTelemetryRouteEnvironmentClassification": route_environment_classification,
        "stationTelemetryRouteRequiredRouteCount": route_probe.get("requiredRouteCount", len(required_routes)),
        "stationTelemetryRouteRequiredRoutes": required_routes,
        "stationTelemetryRouteProbedRouteCount": route_probe.get("probedRouteCount", len(probed_routes)),
        "stationTelemetryRouteProbedRoutes": probed_routes,
        "stationTelemetryRouteLocalSourceStatus": local_source_status,
        "stationTelemetryRouteLocalSourceProofStatus": local_source_proof_status,
        "stationTelemetryRouteLocalSourceRegisteredRouteCount": route_probe.get(
            "localSourceRegisteredRouteCount", len(local_registered_routes)
        ),
        "stationTelemetryRouteLocalSourceMissingRouteCount": local_source_missing_route_count,
        "stationTelemetryRouteLocalSourceRouteContractProofStatus": route_probe.get("localSourceRouteContractProofStatus"),
        "stationTelemetryRouteLocalSourceRegisteredRouteContractCount": route_probe.get(
            "localSourceRegisteredRouteContractCount"
        ),
        "stationTelemetryRouteLocalSourceMissingRouteContractCount": route_probe.get(
            "localSourceMissingRouteContractCount"
        ),
        "stationTelemetryRouteLocalSourceDeploymentStatus": route_probe.get("localSourceDeploymentStatus"),
        "stationTelemetryRouteLocalSourceDeploymentProofStatus": route_probe.get("localSourceDeploymentProofStatus"),
        "stationTelemetryRouteLocalSourceDeploymentReason": route_probe.get("localSourceDeploymentReason"),
        "stationTelemetryRouteLocalSourceHeadRouteContractStatus": route_probe.get(
            "localSourceHeadRouteContractStatus"
        ),
        "stationTelemetryRouteLocalSourceHeadRouteContractProofStatus": route_probe.get(
            "localSourceHeadRouteContractProofStatus"
        ),
        "stationTelemetryRouteLocalSourceHeadRegisteredRouteContractCount": route_probe.get(
            "localSourceHeadRegisteredRouteContractCount"
        ),
        "stationTelemetryRouteLocalSourceHeadMissingRouteContractCount": route_probe.get(
            "localSourceHeadMissingRouteContractCount"
        ),
        "stationTelemetryRouteLocalSourceDirtyRelevantPaths": route_probe.get("localSourceDirtyRelevantPaths") or [],
        "stationTelemetryRouteLocalSourceUntrackedRelevantPaths": route_probe.get(
            "localSourceUntrackedRelevantPaths"
        )
        or [],
        "stationTelemetryRouteTargetRuntimeStatus": target_runtime_status,
        "stationTelemetryRouteTargetRuntimeProofStatus": target_runtime_proof_status,
        "stationTelemetryRouteTargetRuntimeVersionStatus": route_probe.get(
            "targetRuntimeVersionStatus",
            target_route_evidence.get("versionStatus"),
        ),
        "stationTelemetryRouteTargetRuntimeVersionProofStatus": route_probe.get(
            "targetRuntimeVersionProofStatus",
            target_route_evidence.get("versionProofStatus"),
        ),
        "stationTelemetryRouteTargetRuntimeVersionFingerprint": target_runtime_version_fingerprint,
        "stationTelemetryRouteTargetRuntimeBuildCommit": target_runtime_version_fingerprint.get("buildCommit")
        if isinstance(target_runtime_version_fingerprint, dict)
        else None,
        "stationTelemetryRouteTargetRuntimeBuildLabel": target_runtime_version_fingerprint.get("buildLabel")
        if isinstance(target_runtime_version_fingerprint, dict)
        else None,
        "stationTelemetryRouteTargetRuntimeBuildTime": target_runtime_version_fingerprint.get("buildTime")
        if isinstance(target_runtime_version_fingerprint, dict)
        else None,
        "stationTelemetryRouteTargetRuntimeIdentityStatus": route_probe.get(
            "targetRuntimeIdentityStatus",
            target_route_evidence.get("identityStatus"),
        ),
        "stationTelemetryRouteTargetRuntimeIdentityProofStatus": route_probe.get(
            "targetRuntimeIdentityProofStatus",
            target_route_evidence.get("identityProofStatus"),
        ),
        "stationTelemetryRouteTargetRuntimeIdentityMissingFields": target_runtime_identity.get("missingFields")
        if isinstance(target_runtime_identity, dict)
        else [],
        "stationTelemetryRouteTargetRuntimeHandlerCount": route_probe.get(
            "targetRuntimeHandlerCount", target_route_evidence.get("handlerCount")
        ),
        "stationTelemetryRouteTargetRuntimeRouteContractProofStatus": route_probe.get(
            "targetRuntimeRouteContractProofStatus",
            target_route_evidence.get("routeContractProofStatus"),
        ),
        "stationTelemetryRouteTargetRuntimeMatchedRouteContractCount": route_probe.get(
            "targetRuntimeMatchedRouteContractCount"
        ),
        "stationTelemetryRouteTargetRuntimeMissingRouteContractCount": route_probe.get(
            "targetRuntimeMissingRouteContractCount"
        ),
        "stationTelemetryRouteTargetRuntimeMissingRouteContracts": route_probe.get(
            "targetRuntimeMissingRouteContracts",
            target_route_evidence.get("missingRouteContracts"),
        ),
        "stationTelemetryRouteTargetRuntimeRouteContractSummary": route_probe.get(
            "targetRuntimeRouteContractSummary"
        )
        or matrix_summary.get("stationTelemetryRouteTargetRuntimeRouteContractSummary")
        or [],
        "stationTelemetryRouteTargetRuntimeRegisteredRouteCount": route_probe.get(
            "targetRuntimeRegisteredRouteCount", len(target_registered_routes)
        ),
        "stationTelemetryRouteTargetRuntimeMissingRouteCount": route_probe.get(
            "targetRuntimeMissingRouteCount", len(target_missing_routes)
        ),
        "stationTelemetryRouteTargetRuntimeMissingRoutes": target_missing_routes,
        "stationTelemetryDbSchemaStatus": db_schema.get("status"),
        "stationTelemetryDbSchemaProofStatus": db_schema.get("proofStatus"),
        "stationTelemetryDbSchemaRuntimeMigrationProofStatus": db_schema.get("runtimeMigrationProofStatus"),
        "stationTelemetryDbSchemaMigrationPolicy": db_schema.get("migrationPolicy"),
        "stationTelemetryDbSchemaVersionedMigrationStatus": db_schema.get("versionedMigrationStatus"),
        "stationTelemetryDbSchemaVersionedMigrationProofStatus": db_schema.get("versionedMigrationProofStatus"),
        "stationTelemetryLocalLoopStatus": local_loop.get("status"),
        "stationTelemetryLocalLoopProofStatus": local_loop.get("proofStatus"),
        "stationTelemetryLocalLoopSourcePhase": local_loop.get("sourcePhase"),
        "stationTelemetryLocalLoopSourceBom": local_loop.get("sourceBom"),
        "stationTelemetryLocalLoopSourceSpec": local_loop.get("sourceSpec"),
        "stationTelemetryLocalLoopSourceGate": local_loop.get("sourceGate"),
        "stationTelemetryLocalLoopStationStatus": local_loop.get("stationIngestQueryRollupStatus"),
        "stationTelemetryLocalLoopDesktopStatus": local_loop.get("desktopEnvelopeBoundedQueueStatus"),
        "stationTelemetryLocalLoopTauriStatus": local_loop.get("tauriGatewayUploadValidationStatus"),
        "stationTelemetryLocalLoopGatewayUploadSourceStatus": local_loop.get("gatewayUploadSourceStatus"),
        "stationTelemetryLocalLoopGatewayUploadSourceProofStatus": local_loop.get("gatewayUploadSourceProofStatus"),
        "stationTelemetryLocalLoopGatewayUploadSourceFailedRequirements": local_loop.get(
            "gatewayUploadSourceFailedRequirements"
        )
        or [],
        "stationTelemetryRuntimeClosureStatus": runtime_closure.get("status"),
        "stationTelemetryRuntimeClosureProofStatus": runtime_closure.get("proofStatus"),
        "stationTelemetryRuntimeClosureSampleEmissionAllowed": runtime_closure.get("sampleEmissionAllowed"),
        "stationTelemetryRuntimeClosureManagedRuntime": runtime_closure.get("managedRuntimeClosure"),
        "stationTelemetryRuntimeClosureLocalProofStatus": runtime_closure.get("localRuntimeClosureProofStatus"),
        "stationTelemetryRuntimeClosureComposeProofStatus": runtime_closure.get("composeRuntimeClosureProofStatus"),
        "stationTelemetryRuntimeClosureDockerDaemonProofStatus": runtime_closure.get("dockerDaemonProofStatus"),
        "stationTelemetryRuntimeClosureFailedCheckCount": runtime_closure.get("failedCheckCount"),
        "stationTelemetryRuntimeClosureFailedChecks": runtime_closure.get("failedChecks") or [],
        "stationTelemetryRuntimeClosureCheckReasons": runtime_closure.get("checkReasons") or {},
        "stationTelemetryRuntimeClosureFailedCheckReasons": runtime_closure.get("failedCheckReasons") or {},
        "stationTelemetryRuntimeClosureLocalFailedChecks": runtime_closure.get("localFailedChecks") or [],
        "stationTelemetryRuntimeClosureComposeFailedChecks": runtime_closure.get("composeFailedChecks") or [],
        "stationTelemetryRuntimeClosureLocalRuntimeClosure": runtime_closure.get("localRuntimeClosure") or {},
        "stationTelemetryRuntimeClosureComposeRuntimeClosure": runtime_closure.get("composeRuntimeClosure") or {},
        "stationTelemetryRuntimeClosureFailedStep": runtime_closure.get("failedStep"),
        "stationTelemetryRuntimeClosureBlockedStep": runtime_closure.get("blockedStep"),
        "stationTelemetryRuntimeClosureBlockedByStep": runtime_closure.get("blockedByStep"),
        "stationTelemetryRuntimeClosureBlockedDownstreamSteps": runtime_closure.get("blockedDownstreamSteps")
        or [],
          "stationTelemetryRuntimeClosureBlockedDownstreamProofs": runtime_closure.get("blockedDownstreamProofs")
          or [],
          "stationTelemetryRuntimeClosureBlockedDownstreamProofCount": len(
              runtime_closure.get("blockedDownstreamProofs") or []
          ),
        "localTelemetryBufferStatus": local_buffer.get("status"),
        "localTelemetryBufferProofStatus": local_buffer.get("proofStatus"),
        "localTelemetryBufferEventCount": local_buffer.get("eventCount"),
        "localTelemetryBufferDroppedCount": local_buffer.get("droppedCount"),
        "localTelemetryBufferObservationTemplateJsonPath": local_buffer.get("observationTemplateJsonPath"),
        "localTelemetryBufferObservationTemplateMarkdownPath": local_buffer.get("observationTemplateMarkdownPath"),
        "localTelemetryBufferRequiredObservationFields": local_buffer.get("requiredObservationFields") or [],
        "localTelemetryBufferPresentObservationFields": local_buffer.get("presentObservationFields") or [],
        "localTelemetryBufferMissingObservationFields": local_buffer.get("missingObservationFields") or [],
        "localTelemetryBufferObservationSourceStatus": local_buffer.get("observationSourceStatus"),
        "localTelemetryBufferObservationSourceProofStatus": local_buffer.get("observationSourceProofStatus"),
        "localTelemetryBufferObservationExpectedSource": local_buffer.get("observationExpectedSource"),
        "localTelemetryBufferObservationActualSource": local_buffer.get("observationActualSource"),
        "localTelemetryBufferObservationConsistencyStatus": local_buffer.get("observationConsistencyStatus"),
        "localTelemetryBufferObservationConsistencyProofStatus": local_buffer.get("observationConsistencyProofStatus"),
        "localTelemetryBufferObservationByKindCountSum": local_buffer.get("observationByKindCountSum"),
        "localTelemetryBufferObservationWithInteractionCountSum": local_buffer.get("observationWithInteractionCountSum"),
        "localTelemetryBufferRetentionWindowStatus": local_buffer.get("retentionWindowStatus"),
        "localTelemetryBufferRetentionWindowProofStatus": local_buffer.get("retentionWindowProofStatus"),
        "localTelemetryBufferRetentionWindowMaxEvents": local_buffer.get("retentionWindowMaxEvents"),
        "localTelemetryBufferRetentionWindowCapacityProven": local_buffer.get("retentionWindowCapacityProven"),
        "localTelemetryBufferRetentionWindowDroppedByKindCountSum": local_buffer.get(
            "retentionWindowDroppedByKindCountSum"
        ),
        "localTelemetryBufferRetentionWindowDroppedWithInteractionCountSum": local_buffer.get(
            "retentionWindowDroppedWithInteractionCountSum"
        ),
        "localTelemetryBufferRetentionWindowDroppedKindAttributionProven": local_buffer.get(
            "retentionWindowDroppedKindAttributionProven"
        ),
        "localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid": local_buffer.get(
            "retentionWindowDroppedInteractionAttributionValid"
        ),
        "localTelemetryBufferRetentionWindowTotalObservedOrDroppedCount": local_buffer.get(
            "retentionWindowTotalObservedOrDroppedCount"
        ),
        "localTelemetryBufferRetentionWindowDropRatio": local_buffer.get("retentionWindowDropRatio"),
        "localTelemetryBufferRetentionWindowRetainedRatio": local_buffer.get("retentionWindowRetainedRatio"),
        "localTelemetryBufferRetentionWindowTailWindowOnly": local_buffer.get("retentionWindowTailWindowOnly"),
          "localTelemetryBufferRetentionWindowReason": local_buffer.get("retentionWindowReason"),
          "localTelemetryBufferDroppedByKind": local_buffer.get("droppedByKind") or {},
          "localTelemetryBufferDroppedWithInteraction": local_buffer.get("droppedWithInteraction") or {},
        "localTelemetryBufferInteractionEventKindCount": local_buffer.get("interactionEventKindCount"),
        "localTelemetryBufferFamilyPassCount": local_buffer.get("familyPassCount"),
        "localTelemetryBufferFamilyUnprovenCount": local_buffer.get("familyUnprovenCount"),
        "browserGatewayPreflightStatus": browser_gateway_preflight.get("status"),
        "browserGatewayPreflightProofStatus": browser_gateway_preflight.get("proofStatus"),
        "browserGatewayLiveStatus": matrix_summary.get("browserGatewayLiveStatus"),
        "browserGatewayLiveProofStatus": matrix_summary.get("browserGatewayLiveProofStatus"),
          "browserGatewayLiveSourceArtifactKind": matrix_summary.get("browserGatewayLiveSourceArtifactKind"),
          "browserGatewayLiveSourcePhase": matrix_summary.get("browserGatewayLiveSourcePhase"),
          "browserGatewayLiveSourceBom": matrix_summary.get("browserGatewayLiveSourceBom"),
          "browserGatewayLiveSourceSpec": matrix_summary.get("browserGatewayLiveSourceSpec"),
          "browserGatewayLiveSourceGate": matrix_summary.get("browserGatewayLiveSourceGate"),
        "browserGatewayLiveFailedStep": matrix_summary.get("browserGatewayLiveFailedStep"),
        "browserGatewayLivePassedStepCount": matrix_summary.get("browserGatewayLivePassedStepCount"),
        "browserGatewayLiveFailedStepCount": matrix_summary.get("browserGatewayLiveFailedStepCount"),
        "browserGatewayLivePendingStepCount": matrix_summary.get("browserGatewayLivePendingStepCount"),
        "browserGatewayLivePassedSteps": matrix_summary.get("browserGatewayLivePassedSteps"),
        "browserGatewayLivePendingSteps": matrix_summary.get("browserGatewayLivePendingSteps"),
        "browserGatewayLiveEnvironmentClassification": matrix_summary.get("browserGatewayLiveEnvironmentClassification"),
        "browserGatewayLiveBlockedStep": matrix_summary.get("browserGatewayLiveBlockedStep"),
        "browserGatewayLiveBlockedPhase": matrix_summary.get("browserGatewayLiveBlockedPhase"),
        "browserGatewayLiveBlockedByStep": matrix_summary.get("browserGatewayLiveBlockedByStep"),
        "browserGatewayLiveBlockedByPhase": matrix_summary.get("browserGatewayLiveBlockedByPhase"),
        "browserGatewayLiveBlockedByGate": matrix_summary.get("browserGatewayLiveBlockedByGate"),
        "browserGatewayLiveBlockedDownstreamSteps": matrix_summary.get("browserGatewayLiveBlockedDownstreamSteps"),
          "browserGatewayLiveRuntimeClosureStatus": matrix_summary.get("browserGatewayLiveRuntimeClosureStatus"),
          "browserGatewayLiveRuntimeClosureProofStatus": matrix_summary.get("browserGatewayLiveRuntimeClosureProofStatus"),
          "browserGatewayLiveRuntimeClosureSampleEmissionAllowed": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureSampleEmissionAllowed"
          ),
          "browserGatewayLiveRuntimeClosureManagedRuntime": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureManagedRuntime"
          ),
          "browserGatewayLiveRuntimeClosureLocalProofStatus": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureLocalProofStatus"
          ),
          "browserGatewayLiveRuntimeClosureComposeProofStatus": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureComposeProofStatus"
          ),
          "browserGatewayLiveRuntimeClosureDockerDaemonProofStatus": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureDockerDaemonProofStatus"
          ),
          "browserGatewayLiveRuntimeClosureFailedCheckCount": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureFailedCheckCount"
          ),
          "browserGatewayLiveRuntimeClosureCheckReasons": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureCheckReasons"
          )
          or {},
          "browserGatewayLiveRuntimeClosureFailedCheckReasons": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureFailedCheckReasons"
          )
          or {},
          "browserGatewayLiveRuntimeClosureLocalRuntimeClosure": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureLocalRuntimeClosure"
          )
          or {},
          "browserGatewayLiveRuntimeClosureComposeRuntimeClosure": matrix_summary.get(
              "browserGatewayLiveRuntimeClosureComposeRuntimeClosure"
          )
          or {},
            "browserGatewayLiveRuntimeClosureBlockedDownstreamProofs": matrix_summary.get(
                "browserGatewayLiveRuntimeClosureBlockedDownstreamProofs"
            )
            or [],
            "browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount": matrix_summary.get(
                "browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount"
            )
            or len(matrix_summary.get("browserGatewayLiveRuntimeClosureBlockedDownstreamProofs") or []),
        "browserGatewayLiveTargetRuntimeVersionProofStatus": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeVersionProofStatus"
        ),
        "browserGatewayLiveTargetRuntimeBuildCommit": matrix_summary.get("browserGatewayLiveTargetRuntimeBuildCommit"),
        "browserGatewayLiveTargetRuntimeBuildLabel": matrix_summary.get("browserGatewayLiveTargetRuntimeBuildLabel"),
        "browserGatewayLiveTargetRuntimeBuildTime": matrix_summary.get("browserGatewayLiveTargetRuntimeBuildTime"),
        "browserGatewayLiveTargetRuntimeIdentityProofStatus": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeIdentityProofStatus"
        ),
        "browserGatewayLiveTargetRuntimeIdentityMissingFields": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeIdentityMissingFields"
        ),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourceArtifact": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceArtifact"
        )
        or route_probe.get("sourceArtifact")
        or route_probe.get("path")
        or browser_gateway_live_evidence.get("sourceArtifact")
        or browser_gateway_live_evidence.get("path"),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourceKind": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceKind"
        )
        or route_probe.get("sourceArtifactKind")
        or browser_gateway_live_evidence.get("sourceArtifactKind"),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourcePhase": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourcePhase"
        )
        or route_probe.get("sourcePhase")
        or browser_gateway_live_evidence.get("sourcePhase"),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourceBom": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceBom"
        )
        or route_probe.get("sourceBom")
        or browser_gateway_live_evidence.get("sourceBom"),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourceSpec": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceSpec"
        )
        or route_probe.get("sourceSpec")
        or browser_gateway_live_evidence.get("sourceSpec"),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourceGate": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceGate"
        )
        or route_probe.get("sourceGate")
        or browser_gateway_live_evidence.get("sourceGate"),
        "browserGatewayLiveTargetRuntimeRouteEvidenceSourceReason": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceReason"
        )
        or route_probe.get("reason")
        or browser_gateway_live_evidence.get("reason"),
        "browserGatewayLiveTargetRuntimeRouteContractProofStatus": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeRouteContractProofStatus"
        ),
        "browserGatewayLiveTargetRuntimeMatchedRouteContractCount": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeMatchedRouteContractCount"
        ),
        "browserGatewayLiveTargetRuntimeMissingRouteContractCount": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeMissingRouteContractCount"
        ),
        "browserGatewayLiveTargetRuntimeMissingRouteContracts": matrix_summary.get(
            "browserGatewayLiveTargetRuntimeMissingRouteContracts"
        ),
        "browserGatewayDomEvidenceStatus": browser_gateway_dom.get("status"),
        "browserGatewayDomEvidenceProofStatus": browser_gateway_dom.get("proofStatus"),
        "anchorSourceGateStatus": report.get("anchorSourceGate", {}).get("status")
        if isinstance(report.get("anchorSourceGate"), dict)
        else None,
        "anchorInventoryStatus": anchor_inventory.get("status"),
        "anchorInventoryProofStatus": anchor_inventory.get("proofStatus"),
        "anchorInventorySampleEmissionAllowed": anchor_inventory.get("sampleEmissionAllowed"),
        "anchorInventorySourceAnchorsPresent": anchor_inventory_source.get("presentCount"),
        "anchorInventorySourceAnchorsRequired": anchor_inventory_source.get("requiredCount"),
        "anchorInventoryDomAutomationStatus": anchor_inventory_dom.get("status"),
        "anchorInventoryDomAutomationProofStatus": anchor_inventory_dom.get("proofStatus"),
        "anchorInventoryBrowserAnchorsProven": anchor_inventory_browser.get("provenCount"),
        "anchorInventoryBrowserAnchorsRequired": anchor_inventory_browser.get("requiredCount"),
        "anchorInventoryTauriAnchorsProven": anchor_inventory_tauri.get("provenCount"),
        "anchorInventoryTauriAnchorsRequired": anchor_inventory_tauri.get("requiredCount"),
        "anchorInventoryTauriMissingAnchors": anchor_inventory_tauri.get("missingAnchors"),
          "anchorDomEvidenceStatus": anchor_dom_gate.get("status"),
          "anchorDomEvidenceProofStatus": anchor_dom_gate.get("proofStatus"),
        "anchorDomEvidenceGateStatus": anchor_dom_gate.get("status"),
        "anchorDomEvidenceGateProofStatus": anchor_dom_gate.get("proofStatus"),
        "anchorDomEvidenceGateSampleEmissionAllowed": anchor_dom_gate.get("sampleEmissionAllowed"),
        "anchorDomEvidenceRequiredAnchorCount": anchor_dom.get("requiredCount"),
        "anchorDomEvidenceProvenAnchorCount": anchor_dom.get("provenCount"),
        "anchorDomEvidenceBrowserAnchorsProven": anchor_dom_browser.get("provenCount"),
        "anchorDomEvidenceBrowserAnchorsRequired": anchor_dom_browser.get("requiredCount"),
        "anchorDomEvidenceTauriAnchorsProven": anchor_dom_tauri.get("provenCount"),
        "anchorDomEvidenceTauriAnchorsRequired": anchor_dom_tauri.get("requiredCount"),
        "anchorDomEvidenceTauriMissingAnchors": anchor_dom_tauri.get("missingAnchors"),
        "anchorDomEvidenceBlockedBySteps": anchor_dom_summary.get("blockedBySteps") or [],
        "anchorDomEvidenceBlockedRuntimeCells": anchor_dom_summary.get("blockedRuntimeCells") or [],
        "anchorDomEvidenceBlockedDownstreamSteps": anchor_dom_summary.get("blockedDownstreamSteps") or [],
        "anchorDomEvidenceBlockedStep": anchor_dom_summary.get("blockedStep"),
        "anchorDomEvidenceBlockedPhase": anchor_dom_summary.get("blockedPhase"),
        "samplerGateStatus": report.get("samplerGate", {}).get("status")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerGateProofStatus": report.get("samplerGate", {}).get("proofStatus")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerCount": report.get("samplerGate", {}).get("samplerCount", 0)
        if isinstance(report.get("samplerGate"), dict)
        else 0,
        "samplerStationMirrorStatus": report.get("samplerGate", {}).get("stationMirrorStatus")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerStationMirrorProofStatus": report.get("samplerGate", {}).get("stationMirrorProofStatus")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "provenSamplerCount": report.get("samplerGate", {}).get("provenSamplerCount")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "unprovenSamplerCount": report.get("samplerGate", {}).get("unprovenSamplerCount")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "provenSamplers": report.get("samplerGate", {}).get("provenSamplers")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "unprovenSamplers": report.get("samplerGate", {}).get("unprovenSamplers")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerBlockedScopeCount": report.get("samplerGate", {}).get("blockedScopeCount")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerBlockedScopes": report.get("samplerGate", {}).get("blockedScopes")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerDomAnchorGateStatus": sampler_gate.get("domAnchorGateStatus")
        if sampler_gate
        else None,
        "samplerDomAnchorGateProofStatus": sampler_gate.get("domAnchorGateProofStatus")
        if sampler_gate
        else None,
        "samplerDomAnchorBlockedBySteps": sampler_gate.get("domAnchorBlockedBySteps")
        if sampler_gate
        else None,
        "samplerDomAnchorBlockedDownstreamSteps": sampler_gate.get("domAnchorBlockedDownstreamSteps")
        if sampler_gate
        else None,
        "samplerLocalTelemetryBufferStatus": sampler_gate.get("localTelemetryBufferStatus")
        if sampler_gate
        else None,
        "samplerLocalTelemetryBufferProofStatus": sampler_gate.get("localTelemetryBufferProofStatus")
        if sampler_gate
        else None,
        "samplerLocalTelemetryBufferSampleEmissionAllowed": sampler_gate.get("localTelemetryBufferSampleEmissionAllowed")
        if sampler_gate
        else None,
        "samplerLocalTelemetryBufferRequiredObservationFields": sampler_gate.get(
            "localTelemetryBufferRequiredObservationFields"
        )
        if sampler_gate
        else [],
        "samplerLocalTelemetryBufferPresentObservationFields": sampler_gate.get(
            "localTelemetryBufferPresentObservationFields"
        )
        if sampler_gate
        else [],
        "samplerLocalTelemetryBufferMissingObservationFields": sampler_gate.get(
            "localTelemetryBufferMissingObservationFields"
        )
        if sampler_gate
        else [],
        "samplerLocalTelemetryBufferObservationTemplateJsonPath": report.get("samplerGate", {}).get(
            "localTelemetryBufferObservationTemplateJsonPath"
        )
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerLocalTelemetryBufferObservationTemplateMarkdownPath": report.get("samplerGate", {}).get(
            "localTelemetryBufferObservationTemplateMarkdownPath"
        )
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerRuntimeClosureProofStatus": report.get("samplerGate", {}).get("runtimeClosureProofStatus")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerRuntimeClosureSampleEmissionAllowed": report.get("samplerGate", {}).get(
            "runtimeClosureSampleEmissionAllowed"
        )
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "samplerRuntimeClosureDockerDaemonProofStatus": report.get("samplerGate", {}).get(
            "runtimeClosureDockerDaemonProofStatus"
        )
        if isinstance(report.get("samplerGate"), dict)
        else None,
          "samplerRuntimeClosureCheckReasons": report.get("samplerGate", {}).get("runtimeClosureCheckReasons")
          if isinstance(report.get("samplerGate"), dict)
          else {},
          "samplerRuntimeClosureFailedCheckReasons": report.get("samplerGate", {}).get(
              "runtimeClosureFailedCheckReasons"
          )
          if isinstance(report.get("samplerGate"), dict)
          else {},
          "samplerRuntimeClosureLocalRuntimeClosure": report.get("samplerGate", {}).get(
              "runtimeClosureLocalRuntimeClosure"
          )
          if isinstance(report.get("samplerGate"), dict)
          else {},
          "samplerRuntimeClosureComposeRuntimeClosure": report.get("samplerGate", {}).get(
              "runtimeClosureComposeRuntimeClosure"
          )
          if isinstance(report.get("samplerGate"), dict)
          else {},
        "samplerSummaries": report.get("samplerGate", {}).get("samplers")
        if isinstance(report.get("samplerGate"), dict)
        else None,
        "redLineStatus": red_line.get("status"),
        "redLineProofStatus": red_line.get("proofStatus"),
        "redLinePolicyCount": len(red_line.get("policies") or []),
        "redLinePolicyPassedCount": len(
            [policy for policy in (red_line.get("policies") or []) if isinstance(policy, dict) and policy.get("status") == "pass"]
        ),
        "redLinePolicyFailedCount": len(
            [policy for policy in (red_line.get("policies") or []) if isinstance(policy, dict) and policy.get("status") == "fail"]
        ),
        "redLinePolicyDiagnosticIncompleteCount": len(
            [
                policy
                for policy in (red_line.get("policies") or [])
                if isinstance(policy, dict) and policy.get("status") == "diagnostic incomplete"
            ]
        ),
        "redLinePolicySummaries": red_line_policy_summaries(red_line),
    }


def evidence_details_from_issues(issues: Any) -> list[Any]:
    if not isinstance(issues, list):
        return []
    details: list[Any] = []
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        issue_details = issue.get("evidenceDetails", issue.get("details"))
        if isinstance(issue_details, list):
            details.extend(issue_details)
    return details


def runtime_anchor_summary(runtime: Any) -> dict[str, Any]:
    if not isinstance(runtime, dict):
        return {
            "status": "missing",
            "proofStatus": "UNPROVEN",
            "runtimeStatus": "missing",
            "provenCount": 0,
            "requiredCount": 0,
            "missingCount": 0,
            "missingAnchors": [],
        }
    missing = runtime.get("missing", runtime.get("missingAnchors"))
    if not isinstance(missing, list):
        missing = []
    return {
        "status": runtime.get("status", "missing"),
        "proofStatus": runtime.get("proofStatus", "UNPROVEN"),
        "runtimeStatus": runtime.get("runtimeStatus"),
        "provenCount": runtime.get("provenCount", 0),
        "requiredCount": runtime.get("requiredCount", 0),
        "missingCount": len(missing),
        "missingAnchors": [
            str(anchor.get("anchorId") if isinstance(anchor, dict) else anchor)
            for anchor in missing
        ],
        "pageState": (runtime.get("runtimeContext") or {}).get("pageState")
        if isinstance(runtime.get("runtimeContext"), dict)
        else runtime.get("pageState"),
        "readyState": (runtime.get("runtimeContext") or {}).get("readyState")
        if isinstance(runtime.get("runtimeContext"), dict)
        else runtime.get("readyState"),
    }


def red_line_policy_summaries(red_line: dict[str, Any]) -> list[dict[str, Any]]:
    policies = red_line.get("policies")
    if not isinstance(policies, list):
        return []
    summaries: list[dict[str, Any]] = []
    for policy in policies:
        if not isinstance(policy, dict):
            continue
        raw_evidence = policy.get("rawEvidence")
        if not isinstance(raw_evidence, dict):
            raw_evidence = {}
        summaries.append(
            {
                "policyId": policy.get("policyId"),
                "scope": policy.get("scope"),
                "status": policy.get("status"),
                "proofStatus": policy.get("proofStatus"),
                "reason": policy.get("reason"),
                "maxDurationMs": policy.get("maxDurationMs"),
                "requiredEventKinds": policy.get("requiredEventKinds", []),
                "budgetEventKinds": policy.get("budgetEventKinds", []),
                "forbiddenEventKinds": policy.get("forbiddenEventKinds", []),
                "matchedInteractions": policy.get("matchedInteractions"),
                "interactionWindowCount": policy.get("interactionWindowCount"),
                "rawEvidenceStatus": raw_evidence.get("status"),
                "rawEvidencePath": raw_evidence.get("path"),
                "rawEvidenceEventCount": raw_evidence.get("eventCount"),
                "rawSourceArtifactKind": raw_evidence.get("sourceArtifactKind"),
                "rawSourcePhase": raw_evidence.get("sourcePhase"),
                "rawSourceBom": raw_evidence.get("sourceBom"),
                "rawSourceSpec": raw_evidence.get("sourceSpec"),
                "rawSourceGate": raw_evidence.get("sourceGate"),
                "rawCompletionStatus": raw_evidence.get("completionStatus"),
                  "rawProofStatus": raw_evidence.get("proofStatus"),
                  "sampleBlockers": policy.get("sampleBlockers") or [],
            }
        )
    return summaries


def anchor_inventory_state(anchor_report: dict[str, Any] | None, evidence: dict[str, Any]) -> dict[str, Any]:
    if anchor_report is None:
        return {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": f"missing anchor inventory report: {evidence['path']}",
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "issue_breakdown": [
                {
                    "category": "anchor-inventory-report",
                    "failedStep": "missing",
                    "summary": f"Missing anchor inventory report: {evidence['path']}",
                    "sampleEmissionAllowed": False,
                    "proofImpact": "P0b-1 anchor inventory remains PARTIAL/UNPROVEN.",
                }
            ],
            "issueBreakdown": [
                {
                    "category": "anchor-inventory-report",
                    "failedStep": "missing",
                    "summary": f"Missing anchor inventory report: {evidence['path']}",
                    "sampleEmissionAllowed": False,
                    "proofImpact": "P0b-1 anchor inventory remains PARTIAL/UNPROVEN.",
                }
            ],
            "recommended_review_commands": [
                {
                    "purpose": "Re-run the anchor inventory gate.",
                    "command": "python3 tooling/scripts/desktop-anchor-inventory.py",
                },
                {
                    "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime DOM samples are still missing.",
                    "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
                },
            ],
            "recommendedReviewCommands": [
                {
                    "purpose": "Re-run the anchor inventory gate.",
                    "command": "python3 tooling/scripts/desktop-anchor-inventory.py",
                },
                {
                    "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime DOM samples are still missing.",
                    "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
                },
            ],
            "sourceAnchors": {"status": "missing", "presentCount": 0, "requiredCount": 0},
            "domAutomation": {"status": "missing", "proofStatus": "UNPROVEN"},
        }
    source_anchors = anchor_report.get("sourceAnchors", {})
    dom_automation = anchor_report.get("domAutomation", {})
    issue_breakdown = anchor_report.get("issue_breakdown", anchor_report.get("issueBreakdown"))
    review_commands = anchor_report.get("recommended_review_commands", anchor_report.get("recommendedReviewCommands"))
    state = {
        "status": anchor_report.get("status", "diagnostic incomplete"),
        "completionStatus": anchor_report.get("completionStatus", "PARTIAL"),
        "proofStatus": anchor_report.get("proofStatus", "UNPROVEN"),
        "sampleEmissionAllowed": bool(anchor_report.get("sampleEmissionAllowed")),
        "artifactKind": anchor_report.get("artifactKind"),
        "evidencePath": evidence["path"],
        "evidenceStatus": evidence["status"],
        "reason": (
            dom_automation.get("reason") or "anchor inventory is not proven"
            if anchor_report.get("status") != "pass"
            else "source anchors and browser/Tauri DOM automation evidence are proven"
        ),
        "sourceAnchors": {
            "status": source_anchors.get("status", "missing"),
            "presentCount": source_anchors.get("presentCount", 0),
            "requiredCount": source_anchors.get("requiredCount", 0),
        },
        "domAutomation": {
            "status": dom_automation.get("status", "missing"),
            "path": dom_automation.get("path"),
            "sourceArtifact": dom_automation.get("sourceArtifact") or dom_automation.get("path"),
            "evidenceStatus": dom_automation.get("evidenceStatus"),
            "sourceStatus": dom_automation.get("evidenceStatus"),
            "completionStatus": dom_automation.get("completionStatus"),
            "proofStatus": dom_automation.get("proofStatus", "UNPROVEN"),
            "sourcePhase": dom_automation.get("sourcePhase"),
            "sourceBom": dom_automation.get("sourceBom", []),
            "sourceSpec": dom_automation.get("sourceSpec", []),
            "sourceGate": dom_automation.get("sourceGate"),
            "sourceArtifactKind": dom_automation.get("sourceArtifactKind"),
            "requiredCount": dom_automation.get("requiredCount", 0),
            "provenCount": dom_automation.get("provenCount", 0),
            "browser": runtime_anchor_summary(dom_automation.get("browser")),
            "tauri": runtime_anchor_summary(dom_automation.get("tauri")),
            "details": dom_automation.get("details", []),
            "issue_breakdown": dom_automation.get("issue_breakdown", dom_automation.get("issueBreakdown", [])),
            "issueBreakdown": dom_automation.get("issueBreakdown", dom_automation.get("issue_breakdown", [])),
            "recommended_review_commands": dom_automation.get(
                "recommended_review_commands", dom_automation.get("recommendedReviewCommands", [])
            ),
            "recommendedReviewCommands": dom_automation.get(
                "recommendedReviewCommands", dom_automation.get("recommended_review_commands", [])
            ),
        },
    }
    if isinstance(issue_breakdown, list):
        state["issue_breakdown"] = issue_breakdown
        state["issueBreakdown"] = issue_breakdown
    if isinstance(review_commands, list):
        state["recommended_review_commands"] = review_commands
        state["recommendedReviewCommands"] = review_commands
    return state


def anchor_dom_evidence_gate_state(
    dom_gate_report: dict[str, Any] | None,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    if dom_gate_report is None:
        return {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": f"missing anchor DOM evidence gate report: {evidence['path']}",
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "issue_breakdown": [
                {
                    "category": "anchor-dom-evidence-gate",
                    "failedStep": "missing",
                    "summary": f"Missing anchor DOM evidence gate report: {evidence['path']}",
                    "sampleEmissionAllowed": False,
                    "proofImpact": "P0b-1 DOM evidence gate remains PARTIAL/UNPROVEN.",
                }
            ],
            "issueBreakdown": [
                {
                    "category": "anchor-dom-evidence-gate",
                    "failedStep": "missing",
                    "summary": f"Missing anchor DOM evidence gate report: {evidence['path']}",
                    "sampleEmissionAllowed": False,
                    "proofImpact": "P0b-1 DOM evidence gate remains PARTIAL/UNPROVEN.",
                }
            ],
            "recommended_review_commands": [
                {
                    "purpose": "Re-run the independent anchor DOM evidence gate.",
                    "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-gate.py",
                },
                {
                    "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime DOM samples are still missing.",
                    "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
                },
            ],
            "recommendedReviewCommands": [
                {
                    "purpose": "Re-run the independent anchor DOM evidence gate.",
                    "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-gate.py",
                },
                {
                    "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime DOM samples are still missing.",
                    "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
                },
            ],
            "domAutomation": {"status": "missing", "proofStatus": "UNPROVEN"},
        }
    dom_automation = dom_gate_report.get("domAutomation", {})
    gate_summary = dom_gate_report.get("summary")
    if not isinstance(gate_summary, dict):
        gate_summary = {}
    issue_breakdown = dom_gate_report.get("issue_breakdown", dom_gate_report.get("issueBreakdown"))
    review_commands = dom_gate_report.get("recommended_review_commands", dom_gate_report.get("recommendedReviewCommands"))
    state = {
        "status": dom_gate_report.get("status", "diagnostic incomplete"),
        "completionStatus": dom_gate_report.get("completionStatus", "PARTIAL"),
        "proofStatus": dom_gate_report.get("proofStatus", "UNPROVEN"),
        "sampleEmissionAllowed": bool(dom_gate_report.get("sampleEmissionAllowed")),
        "artifactKind": dom_gate_report.get("artifactKind"),
        "reason": (
            dom_automation.get("reason") or "anchor DOM evidence gate is not proven"
            if dom_gate_report.get("status") != "pass"
            else "browser/Tauri DOM automation evidence is proven"
        ),
        "evidencePath": evidence["path"],
        "evidenceStatus": evidence["status"],
        "summary": {
            "blockedRuntimeCells": gate_summary.get("blockedRuntimeCells") or [],
            "blockedBySteps": gate_summary.get("blockedBySteps") or [],
            "blockedDownstreamSteps": gate_summary.get("blockedDownstreamSteps") or [],
            "blockedStep": gate_summary.get("blockedStep"),
            "blockedPhase": gate_summary.get("blockedPhase"),
        },
        "domAutomation": {
            "status": dom_automation.get("status", "missing"),
            "proofStatus": dom_automation.get("proofStatus", "UNPROVEN"),
            "path": dom_automation.get("path"),
            "sourceArtifact": dom_automation.get("sourceArtifact") or dom_automation.get("path"),
            "evidenceStatus": dom_automation.get("evidenceStatus"),
            "sourceStatus": dom_automation.get("evidenceStatus"),
            "completionStatus": dom_automation.get("completionStatus"),
            "sourcePhase": dom_automation.get("sourcePhase"),
            "sourceBom": dom_automation.get("sourceBom", []),
            "sourceSpec": dom_automation.get("sourceSpec", []),
            "sourceGate": dom_automation.get("sourceGate"),
            "sourceArtifactKind": dom_automation.get("sourceArtifactKind"),
            "requiredCount": dom_automation.get("requiredCount", 0),
            "provenCount": dom_automation.get("provenCount", 0),
            "browser": runtime_anchor_summary(dom_automation.get("browser")),
            "tauri": runtime_anchor_summary(dom_automation.get("tauri")),
            "details": dom_automation.get("details", []),
            "issue_breakdown": dom_automation.get("issue_breakdown", dom_automation.get("issueBreakdown", [])),
            "issueBreakdown": dom_automation.get("issueBreakdown", dom_automation.get("issue_breakdown", [])),
            "recommended_review_commands": dom_automation.get(
                "recommended_review_commands", dom_automation.get("recommendedReviewCommands", [])
            ),
            "recommendedReviewCommands": dom_automation.get(
                "recommendedReviewCommands", dom_automation.get("recommended_review_commands", [])
            ),
        },
    }
    if isinstance(issue_breakdown, list):
        state["issue_breakdown"] = issue_breakdown
        state["issueBreakdown"] = issue_breakdown
    if isinstance(review_commands, list):
        state["recommended_review_commands"] = review_commands
        state["recommendedReviewCommands"] = review_commands
    return state


def rollup_summary(station_report: dict[str, Any] | None) -> list[dict[str, Any]]:
    if station_report is None:
        return []
    rollups = station_report.get("rollups", [])
    if not isinstance(rollups, list):
        return []
    summaries: list[dict[str, Any]] = []
    for rollup in rollups:
        if not isinstance(rollup, dict):
            continue
        summaries.append(
            {
                "module": rollup.get("module"),
                "runtime": rollup.get("runtime"),
                "kind": rollup.get("kind"),
                "count": rollup.get("count"),
                "p50DurationMs": rollup.get("p50DurationMs"),
                "p95DurationMs": rollup.get("p95DurationMs"),
                "maxDurationMs": rollup.get("maxDurationMs"),
            }
        )
    return summaries


def numeric_duration(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def react_commit_aggregation(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "missing Station mirror report",
            "commitCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "windows": [],
        }
    events = station_report.get("events", [])
    if not isinstance(events, list):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "Station mirror events field is missing or invalid",
            "commitCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "windows": [],
        }
    commits = [event for event in events if isinstance(event, dict) and event.get("kind") == "react.commit"]
    if not commits:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no react.commit events in Station mirror",
            "commitCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "windows": [],
        }

    grouped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for event in commits:
        key = (
            str(event.get("interactionId") or "unlinked"),
            str(event.get("owner") or "unknown"),
            str(event.get("source") or "unknown"),
            str(event.get("module") or "unknown"),
        )
        duration = numeric_duration(event.get("durationMs")) or 0.0
        bucket = grouped.setdefault(
            key,
            {
                "interactionId": key[0],
                "owner": key[1],
                "source": key[2],
                "module": key[3],
                "commitCount": 0,
                "totalDurationMs": 0.0,
                "maxDurationMs": 0.0,
            },
        )
        bucket["commitCount"] += 1
        bucket["totalDurationMs"] += duration
        bucket["maxDurationMs"] = max(bucket["maxDurationMs"], duration)

    windows = sorted(
        (
            {
                **bucket,
                "totalDurationMs": round(bucket["totalDurationMs"], 3),
                "maxDurationMs": round(bucket["maxDurationMs"], 3),
            }
            for bucket in grouped.values()
        ),
        key=lambda item: (
            item["interactionId"],
            item["owner"],
            item["source"],
            item["module"],
        ),
    )
    total_duration = sum(window["totalDurationMs"] for window in windows)
    max_duration = max(window["maxDurationMs"] for window in windows)
    return {
        "status": "loaded",
        "proofStatus": "PROVEN",
        "reason": "react.commit events aggregated by interaction/owner/source/module",
        "commitCount": len(commits),
        "totalDurationMs": round(total_duration, 3),
        "maxDurationMs": round(max_duration, 3),
        "windows": windows,
    }


def list_from_data(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None]


def store_update_aggregation(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "missing Station mirror report",
            "updateCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "unknownAttributionCount": 0,
            "stores": [],
        }
    raw_events = station_report.get("events", [])
    if not isinstance(raw_events, list):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "Station mirror events field is missing or invalid",
            "updateCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "unknownAttributionCount": 0,
            "stores": [],
        }
    updates = [event for event in raw_events if isinstance(event, dict) and event.get("kind") == "store.update"]
    if not updates:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no store.update events in Station mirror",
            "updateCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "unknownAttributionCount": 0,
            "stores": [],
        }

    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    unknown_attribution_count = 0
    for event in updates:
        data = event_data(event)
        store_name = str(data.get("store") or event.get("module") or "unknown")
        key = (
            str(event.get("interactionId") or "unlinked"),
            store_name,
            str(event.get("owner") or "unknown"),
        )
        duration = numeric_duration(event.get("durationMs")) or 0.0
        fanout = data.get("fanout", "unknown")
        listener_count = data.get("listenerCount", "unknown")
        if fanout == "unknown" or listener_count == "unknown" or event.get("owner") in (None, "unknown"):
            unknown_attribution_count += 1
        bucket = grouped.setdefault(
            key,
            {
                "interactionId": key[0],
                "store": key[1],
                "owner": key[2],
                "updateCount": 0,
                "totalDurationMs": 0.0,
                "maxDurationMs": 0.0,
                "changedKeys": set(),
                "fanout": fanout,
                "listenerCount": listener_count,
            },
        )
        bucket["updateCount"] += 1
        bucket["totalDurationMs"] += duration
        bucket["maxDurationMs"] = max(bucket["maxDurationMs"], duration)
        bucket["changedKeys"].update(list_from_data(data.get("changedKeys")))
        if bucket["fanout"] == "unknown":
            bucket["fanout"] = fanout
        if bucket["listenerCount"] == "unknown":
            bucket["listenerCount"] = listener_count

    stores = sorted(
        (
            {
                **bucket,
                "changedKeys": sorted(bucket["changedKeys"]),
                "totalDurationMs": round(bucket["totalDurationMs"], 3),
                "maxDurationMs": round(bucket["maxDurationMs"], 3),
            }
            for bucket in grouped.values()
        ),
        key=lambda item: (item["interactionId"], item["store"], item["owner"]),
    )
    total_duration = sum(store["totalDurationMs"] for store in stores)
    max_duration = max(store["maxDurationMs"] for store in stores)
    return {
        "status": "loaded",
        "proofStatus": "PROVEN",
        "reason": "store.update events aggregated by interaction/store/owner; unknown attribution is explicit",
        "updateCount": len(updates),
        "totalDurationMs": round(total_duration, 3),
        "maxDurationMs": round(max_duration, 3),
        "unknownAttributionCount": unknown_attribution_count,
        "stores": stores,
    }


OVERLAY_EVENT_KINDS = {"contextmenu.intent", "overlay.visible", "overlay.hidden"}


def overlay_latency_aggregation(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "missing Station mirror report",
            "intentCount": 0,
            "visibleCount": 0,
            "hiddenCount": 0,
            "pairedVisibleCount": 0,
            "missingVisibleCount": 0,
            "maxVisibleLatencyMs": None,
            "overlays": [],
        }
    raw_events = station_report.get("events", [])
    if not isinstance(raw_events, list):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "Station mirror events field is missing or invalid",
            "intentCount": 0,
            "visibleCount": 0,
            "hiddenCount": 0,
            "pairedVisibleCount": 0,
            "missingVisibleCount": 0,
            "maxVisibleLatencyMs": None,
            "overlays": [],
        }
    events = [event for event in raw_events if isinstance(event, dict) and event.get("kind") in OVERLAY_EVENT_KINDS]
    if not events:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no overlay telemetry events in Station mirror",
            "intentCount": 0,
            "visibleCount": 0,
            "hiddenCount": 0,
            "pairedVisibleCount": 0,
            "missingVisibleCount": 0,
            "maxVisibleLatencyMs": None,
            "overlays": [],
        }

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        data = event_data(event)
        target = str(data.get("overlayTarget") or event.get("owner") or event.get("module") or "unknown")
        key = (str(event.get("interactionId") or "unlinked"), target)
        bucket = grouped.setdefault(
            key,
            {
                "interactionId": key[0],
                "target": key[1],
                "intentCount": 0,
                "visibleCount": 0,
                "hiddenCount": 0,
                "visibleLatencyMs": None,
                "surface": data.get("surface", "unknown"),
            },
        )
        kind = event.get("kind")
        if kind == "contextmenu.intent":
            bucket["intentCount"] += 1
        elif kind == "overlay.visible":
            bucket["visibleCount"] += 1
            duration = numeric_duration(event.get("durationMs"))
            if duration is not None:
                current = bucket["visibleLatencyMs"]
                bucket["visibleLatencyMs"] = duration if current is None else max(current, duration)
        elif kind == "overlay.hidden":
            bucket["hiddenCount"] += 1

    overlays = sorted(
        (
            {
                **bucket,
                "visibleLatencyMs": (
                    None
                    if bucket["visibleLatencyMs"] is None
                    else round(bucket["visibleLatencyMs"], 3)
                ),
                "status": "paired" if bucket["intentCount"] and bucket["visibleCount"] else "missing-visible",
            }
            for bucket in grouped.values()
        ),
        key=lambda item: (item["interactionId"], item["target"]),
    )
    intent_count = sum(item["intentCount"] for item in overlays)
    visible_count = sum(item["visibleCount"] for item in overlays)
    hidden_count = sum(item["hiddenCount"] for item in overlays)
    paired_visible_count = sum(1 for item in overlays if item["status"] == "paired")
    missing_visible_count = sum(1 for item in overlays if item["status"] == "missing-visible")
    latencies = [item["visibleLatencyMs"] for item in overlays if item["visibleLatencyMs"] is not None]
    if not visible_count:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "overlay telemetry has no overlay.visible events",
            "intentCount": intent_count,
            "visibleCount": visible_count,
            "hiddenCount": hidden_count,
            "pairedVisibleCount": paired_visible_count,
            "missingVisibleCount": missing_visible_count,
            "maxVisibleLatencyMs": None,
            "overlays": overlays,
        }
    if missing_visible_count:
        return {
            "status": "fail",
            "proofStatus": "UNPROVEN",
            "reason": "contextmenu.intent events without paired overlay.visible",
            "intentCount": intent_count,
            "visibleCount": visible_count,
            "hiddenCount": hidden_count,
            "pairedVisibleCount": paired_visible_count,
            "missingVisibleCount": missing_visible_count,
            "maxVisibleLatencyMs": max(latencies) if latencies else None,
            "overlays": overlays,
        }
    return {
        "status": "loaded",
        "proofStatus": "PROVEN",
        "reason": "contextmenu.intent and overlay.visible events are paired by interaction/target",
        "intentCount": intent_count,
        "visibleCount": visible_count,
        "hiddenCount": hidden_count,
        "pairedVisibleCount": paired_visible_count,
        "missingVisibleCount": 0,
        "maxVisibleLatencyMs": max(latencies) if latencies else None,
        "overlays": overlays,
    }


INVOKE_EVENT_KINDS = {"invoke.started", "invoke.completed", "invoke.failed"}
INVOKE_TERMINAL_KINDS = {"invoke.completed", "invoke.failed"}


def invoke_aggregation(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "missing Station mirror report",
            "eventCount": 0,
            "terminalCount": 0,
            "failedCount": 0,
            "interactionInvokeCount": 0,
            "startupInvokeCount": 0,
            "backgroundInvokeCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "commands": [],
        }
    raw_events = station_report.get("events", [])
    if not isinstance(raw_events, list):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "Station mirror events field is missing or invalid",
            "eventCount": 0,
            "terminalCount": 0,
            "failedCount": 0,
            "interactionInvokeCount": 0,
            "startupInvokeCount": 0,
            "backgroundInvokeCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "commands": [],
        }
    events = [event for event in raw_events if isinstance(event, dict) and event.get("kind") in INVOKE_EVENT_KINDS]
    terminal_events = [event for event in events if event.get("kind") in INVOKE_TERMINAL_KINDS]
    if not events:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no invoke telemetry events in Station mirror",
            "eventCount": 0,
            "terminalCount": 0,
            "failedCount": 0,
            "interactionInvokeCount": 0,
            "startupInvokeCount": 0,
            "backgroundInvokeCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "commands": [],
        }
    if not terminal_events:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "invoke telemetry has no completed/failed terminal events",
            "eventCount": len(events),
            "terminalCount": 0,
            "failedCount": 0,
            "interactionInvokeCount": 0,
            "startupInvokeCount": 0,
            "backgroundInvokeCount": 0,
            "totalDurationMs": 0,
            "maxDurationMs": None,
            "commands": [],
        }

    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    phase_counts = {"interaction": 0, "startup": 0, "background": 0}
    failed_count = 0
    for event in events:
        data = event_data(event)
        command = str(data.get("command") or event.get("owner") or event.get("module") or "unknown")
        phase = str(event.get("phase") or "background")
        key = (
            str(event.get("interactionId") or "unlinked"),
            command,
            phase,
        )
        bucket = grouped.setdefault(
            key,
            {
                "interactionId": key[0],
                "command": key[1],
                "phase": key[2],
                "startedCount": 0,
                "completedCount": 0,
                "failedCount": 0,
                "totalDurationMs": 0.0,
                "maxDurationMs": 0.0,
                "quiet": data.get("quiet", "unknown"),
            },
        )
        kind = event.get("kind")
        if kind == "invoke.started":
            bucket["startedCount"] += 1
            continue
        duration = numeric_duration(event.get("durationMs")) or 0.0
        bucket["totalDurationMs"] += duration
        bucket["maxDurationMs"] = max(bucket["maxDurationMs"], duration)
        if phase in phase_counts:
            phase_counts[phase] += 1
        if kind == "invoke.failed":
            bucket["failedCount"] += 1
            failed_count += 1
        elif kind == "invoke.completed":
            bucket["completedCount"] += 1

    commands = sorted(
        (
            {
                **bucket,
                "totalDurationMs": round(bucket["totalDurationMs"], 3),
                "maxDurationMs": round(bucket["maxDurationMs"], 3),
            }
            for bucket in grouped.values()
            if bucket["completedCount"] or bucket["failedCount"]
        ),
        key=lambda item: (item["interactionId"], item["phase"], item["command"]),
    )
    total_duration = sum(command["totalDurationMs"] for command in commands)
    max_duration = max(command["maxDurationMs"] for command in commands)
    return {
        "status": "loaded",
        "proofStatus": "PROVEN",
        "reason": "invoke events aggregated by interaction/command/phase; startup/background/interaction cohorts are separated",
        "eventCount": len(events),
        "terminalCount": len(terminal_events),
        "failedCount": failed_count,
        "interactionInvokeCount": phase_counts["interaction"],
        "startupInvokeCount": phase_counts["startup"],
        "backgroundInvokeCount": phase_counts["background"],
        "totalDurationMs": round(total_duration, 3),
        "maxDurationMs": round(max_duration, 3),
        "commands": commands,
    }


MAIN_THREAD_EVENT_KINDS = {"longtask.detected", "layout.shift", "paint.timing"}
INTERACTION_CORRELATION_EVENT_KINDS = {
    "contextmenu.intent",
    "invoke.completed",
    "invoke.failed",
    "invoke.started",
    "overlay.visible",
    "react.commit",
    "route.requested",
    "route.visible",
    "store.update",
    "surface.hidden.render",
    "surface.render",
}


def event_data(event: dict[str, Any]) -> dict[str, Any]:
    data = event.get("data")
    return data if isinstance(data, dict) else {}


def exception_registration(event: dict[str, Any]) -> dict[str, Any] | None:
    exception = event_data(event).get("exception")
    if not isinstance(exception, dict):
        return None
    owner = exception.get("owner") or event.get("owner")
    budget_ms = numeric_duration(exception.get("budgetMs"))
    expires_at = exception.get("expiresAt")
    reason = exception.get("reason")
    if not owner or budget_ms is None or not expires_at or not reason:
        return None
    return {
        "owner": str(owner),
        "budgetMs": budget_ms,
        "expiresAt": str(expires_at),
        "reason": str(reason),
    }


def main_thread_exception_summary(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "missing Station mirror report",
            "eventCount": 0,
            "violationCount": 0,
            "exceptionCount": 0,
            "events": [],
        }
    raw_events = station_report.get("events", [])
    if not isinstance(raw_events, list):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "Station mirror events field is missing or invalid",
            "eventCount": 0,
            "violationCount": 0,
            "exceptionCount": 0,
            "events": [],
        }

    events: list[dict[str, Any]] = []
    violations: list[dict[str, Any]] = []
    exception_count = 0
    for event in raw_events:
        if not isinstance(event, dict) or event.get("kind") not in MAIN_THREAD_EVENT_KINDS:
            continue
        duration = numeric_duration(event.get("durationMs"))
        threshold = numeric_duration(event_data(event).get("thresholdMs"))
        if threshold is None and event.get("kind") == "longtask.detected":
            threshold = 50.0
        exception = exception_registration(event)
        if exception is not None:
            exception_count += 1
        over_budget = threshold is not None and duration is not None and duration > threshold
        item = {
            "kind": event.get("kind"),
            "interactionId": event.get("interactionId") or "unlinked",
            "owner": event.get("owner") or "unknown",
            "module": event.get("module") or "unknown",
            "source": event.get("source") or "unknown",
            "durationMs": duration,
            "thresholdMs": threshold,
            "exception": exception,
            "status": "excepted" if over_budget and exception is not None else ("violation" if over_budget else "within-budget"),
        }
        events.append(item)
        if item["status"] == "violation":
            violations.append(item)

    if not events:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no main-thread longtask/layout/paint events in Station mirror",
            "eventCount": 0,
            "violationCount": 0,
            "exceptionCount": 0,
            "events": [],
        }

    return {
        "status": "fail" if violations else "loaded",
        "proofStatus": "UNPROVEN" if violations else "PROVEN",
        "reason": (
            "main-thread events include unregistered over-budget entries"
            if violations
            else "main-thread events loaded; over-budget entries require owner/budget/expiry/reason exception"
        ),
        "eventCount": len(events),
        "violationCount": len(violations),
        "exceptionCount": exception_count,
        "events": events,
    }


def interaction_correlation_summary(station_report: dict[str, Any] | None) -> dict[str, Any]:
    if station_report is None:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "missing Station mirror report",
            "trackedEventCount": 0,
            "linkedEventCount": 0,
            "unlinkedEventCount": 0,
            "unlinkedEvents": [],
        }
    raw_events = station_report.get("events", [])
    if not isinstance(raw_events, list):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "Station mirror events field is missing or invalid",
            "trackedEventCount": 0,
            "linkedEventCount": 0,
            "unlinkedEventCount": 0,
            "unlinkedEvents": [],
        }

    tracked: list[dict[str, Any]] = []
    unlinked: list[dict[str, Any]] = []
    for event in raw_events:
        if not isinstance(event, dict) or event.get("kind") not in INTERACTION_CORRELATION_EVENT_KINDS:
            continue
        tracked.append(event)
        if not event.get("interactionId"):
            unlinked.append(
                {
                    "kind": event.get("kind"),
                    "module": event.get("module") or "unknown",
                    "owner": event.get("owner") or "unknown",
                    "source": event.get("source") or "unknown",
                    "phase": event.get("phase") or "unknown",
                }
            )

    if not tracked:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no interaction-correlated event families in Station mirror",
            "trackedEventCount": 0,
            "linkedEventCount": 0,
            "unlinkedEventCount": 0,
            "unlinkedEvents": [],
        }
    if unlinked:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "interaction-correlated events are missing interactionId",
            "trackedEventCount": len(tracked),
            "linkedEventCount": len(tracked) - len(unlinked),
            "unlinkedEventCount": len(unlinked),
            "unlinkedEvents": unlinked,
        }
    return {
        "status": "loaded",
        "proofStatus": "PROVEN",
        "reason": "interaction-correlated event families carry interactionId",
        "trackedEventCount": len(tracked),
        "linkedEventCount": len(tracked),
        "unlinkedEventCount": 0,
        "unlinkedEvents": [],
    }


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    station_report, station_evidence = read_json_if_present(Path(args.station_mirror_report))
    matrix_report, matrix_evidence = read_json_if_present(Path(args.matrix_report))
    preflight_path = getattr(args, "preflight_report", None)
    if preflight_path is None:
        preflight_report, preflight_evidence = None, {
            "status": "missing",
            "path": "evidence-store:latest:desktop-performance-preflight-gate:report",
        }
    else:
        preflight_report, preflight_evidence = read_json_if_present(Path(preflight_path))
    anchor_report, anchor_evidence = read_json_if_present(Path(args.anchor_inventory_report))
    anchor_dom_gate_path = getattr(args, "anchor_dom_evidence_gate_report", None)
    if anchor_dom_gate_path is None:
        anchor_dom_gate_report, anchor_dom_gate_evidence = None, {
            "status": "missing",
            "path": "evidence-store:latest:desktop-anchor-dom-evidence-gate:report",
        }
    else:
        anchor_dom_gate_report, anchor_dom_gate_evidence = read_json_if_present(Path(anchor_dom_gate_path))
    anchor_source_gate_path = getattr(args, "anchor_source_gate_report", None)
    if anchor_source_gate_path is None:
        anchor_source_gate_report, anchor_source_gate_evidence = None, {
            "status": "missing",
            "path": "evidence-store:latest:desktop-anchor-source-gate:report",
        }
    else:
        anchor_source_gate_report, anchor_source_gate_evidence = read_json_if_present(Path(anchor_source_gate_path))
    sampler_gate_path = getattr(args, "sampler_gate_report", None)
    if sampler_gate_path is None:
        sampler_gate_report, sampler_gate_evidence = None, {
            "status": "missing",
            "path": "evidence-store:latest:desktop-performance-sampler-gate:report",
        }
    else:
        sampler_gate_report, sampler_gate_evidence = read_json_if_present(Path(sampler_gate_path))
    blocked = blocked_reasons(matrix_report, matrix_evidence)
    preflight = preflight_state(preflight_report, preflight_evidence)
    station_mirror_source = station_mirror_source_state(station_report, station_evidence)
    anchor_source_gate = anchor_source_gate_state(anchor_source_gate_report, anchor_source_gate_evidence)
    sampler_gate = sampler_gate_state(sampler_gate_report, sampler_gate_evidence)
    if station_report is None:
        blocked.append(
            {
                "scope": "station-mirror",
                "status": "diagnostic incomplete",
                "proofStatus": "UNPROVEN",
                "reason": f"missing Station mirror report: {station_evidence['path']}",
                "evidencePath": station_evidence["path"],
                "evidenceStatus": station_evidence["status"],
            }
        )
    if preflight["status"] != "pass":
        blocked.append(
            {
                "scope": "desktop-performance-preflight",
                "status": preflight["status"],
                "proofStatus": preflight["proofStatus"],
                "reason": preflight["reason"],
                "evidencePath": preflight["evidencePath"],
                "evidenceStatus": preflight["evidenceStatus"],
                "sourceArtifact": preflight.get("evidencePath"),
                "sourcePhase": preflight.get("phase"),
                "sourceBom": preflight.get("bom"),
                "sourceSpec": preflight.get("spec"),
                "sourceGate": preflight.get("gate"),
                "completionStatus": preflight.get("completionStatus"),
                "sourceProofStatus": preflight.get("proofStatus"),
                "sourceArtifactKind": preflight.get("artifactKind"),
                "sampleEmissionAllowed": preflight.get("sampleEmissionAllowed"),
                "failedStep": preflight.get("failedStep"),
                "evidenceDetails": preflight.get("details", []),
                "issue_breakdown": preflight.get("issue_breakdown", []),
                "issueBreakdown": preflight.get("issueBreakdown", []),
                "recommended_review_commands": preflight.get("recommended_review_commands", []),
                "recommendedReviewCommands": preflight.get("recommendedReviewCommands", []),
            }
        )
    if sampler_gate["status"] != "pass":
        blocked.append(
            {
                "scope": "sampler-gate",
                "status": sampler_gate["status"],
                "proofStatus": sampler_gate["proofStatus"],
                "reason": sampler_gate["reason"],
                "evidencePath": sampler_gate["evidencePath"],
                "evidenceStatus": sampler_gate["evidenceStatus"],
                "sourceArtifact": sampler_gate.get("evidencePath"),
                "sourcePhase": sampler_gate.get("phase"),
                "sourceBom": sampler_gate.get("bom"),
                "sourceSpec": sampler_gate.get("spec"),
                "sourceGate": sampler_gate.get("gate"),
                "completionStatus": sampler_gate.get("completionStatus"),
                "sourceProofStatus": sampler_gate.get("proofStatus"),
                "sourceArtifactKind": sampler_gate.get("artifactKind"),
                "sampleEmissionAllowed": sampler_gate.get("sampleEmissionAllowed"),
                "evidenceDetails": sampler_gate.get("details", []),
                "issue_breakdown": sampler_gate.get("issue_breakdown", []),
                "issueBreakdown": sampler_gate.get("issueBreakdown", []),
                "recommended_review_commands": sampler_gate.get("recommended_review_commands", []),
                "recommendedReviewCommands": sampler_gate.get("recommendedReviewCommands", []),
            }
        )
    if station_mirror_source["status"] != "loaded":
        blocked.append(
            {
                "scope": "station-mirror-source",
                "status": station_mirror_source["status"],
                "proofStatus": station_mirror_source["proofStatus"],
                "reason": station_mirror_source["reason"],
                "evidencePath": station_mirror_source["evidencePath"],
                "evidenceStatus": station_mirror_source["evidenceStatus"],
                "sourcePhase": station_mirror_source.get("phase"),
                "sourceBom": station_mirror_source.get("bom"),
                "sourceSpec": station_mirror_source.get("spec"),
                "sourceGate": station_mirror_source.get("gate"),
                "sourceArtifact": station_mirror_source.get("evidencePath"),
                "sourceArtifactKind": station_mirror_source.get("artifactKind") or MIRROR_REQUIRED_ARTIFACT_KIND,
                "completionStatus": station_mirror_source.get("completionStatus"),
                "sourceProofStatus": station_mirror_source.get("proofStatus"),
                "evidenceDetails": station_mirror_source.get("details", []),
                "issue_breakdown": station_mirror_source.get("issue_breakdown", []),
                "issueBreakdown": station_mirror_source.get("issueBreakdown", []),
                "recommended_review_commands": station_mirror_source.get("recommended_review_commands", []),
                "recommendedReviewCommands": station_mirror_source.get("recommendedReviewCommands", []),
            }
        )
    if anchor_source_gate["status"] != "pass":
        blocked.append(
            {
                "scope": "anchor-source-gate",
                "status": anchor_source_gate["status"],
                "proofStatus": anchor_source_gate["proofStatus"],
                "reason": anchor_source_gate["reason"],
                "evidencePath": anchor_source_gate["evidencePath"],
                "evidenceStatus": anchor_source_gate["evidenceStatus"],
                "sourceArtifact": anchor_source_gate.get("evidencePath"),
                "sourcePhase": anchor_source_gate.get("phase"),
                "sourceBom": anchor_source_gate.get("bom"),
                "sourceSpec": anchor_source_gate.get("spec"),
                "sourceGate": anchor_source_gate.get("gate"),
                "completionStatus": anchor_source_gate.get("completionStatus"),
                "sourceProofStatus": anchor_source_gate.get("proofStatus"),
                "sourceArtifactKind": anchor_source_gate.get("artifactKind"),
                "sampleEmissionAllowed": anchor_source_gate.get("sampleEmissionAllowed", False),
                "evidenceDetails": anchor_source_gate.get("details", []),
                "issue_breakdown": anchor_source_gate.get("issue_breakdown", []),
                "issueBreakdown": anchor_source_gate.get("issueBreakdown", []),
                "recommended_review_commands": anchor_source_gate.get("recommended_review_commands", []),
                "recommendedReviewCommands": anchor_source_gate.get("recommendedReviewCommands", []),
            }
        )
    anchors = anchor_inventory_state(anchor_report, anchor_evidence)
    anchor_dom_gate = anchor_dom_evidence_gate_state(anchor_dom_gate_report, anchor_dom_gate_evidence)
    if anchors["status"] != "pass":
        dom_automation = anchors.get("domAutomation", {})
        source_trace = evidence_source_trace(dom_automation)
        issue_breakdown = anchors.get("issue_breakdown", [])
        evidence_details = evidence_details_from_issues(issue_breakdown)
        if not evidence_details and isinstance(dom_automation.get("details"), list):
            evidence_details = dom_automation.get("details", [])
        blocked.append(
            {
                "scope": "anchor-inventory",
                "status": anchors["status"],
                "proofStatus": anchors["proofStatus"],
                "reason": anchors["reason"],
                "evidencePath": anchors.get("evidencePath"),
                "evidenceStatus": anchors.get("evidenceStatus"),
                "sourceArtifact": source_trace.get("sourceArtifact") or dom_automation.get("path"),
                **source_trace,
                "evidenceDetails": evidence_details,
                "issue_breakdown": issue_breakdown,
                "issueBreakdown": anchors.get("issueBreakdown", []),
                "recommended_review_commands": anchors.get("recommended_review_commands", []),
                "recommendedReviewCommands": anchors.get("recommendedReviewCommands", []),
            }
        )
    if anchor_dom_gate["status"] != "pass":
        dom_automation = anchor_dom_gate.get("domAutomation", {})
        source_trace = evidence_source_trace(dom_automation)
        issue_breakdown = anchor_dom_gate.get("issue_breakdown", [])
        evidence_details = evidence_details_from_issues(issue_breakdown)
        if not evidence_details and isinstance(dom_automation.get("details"), list):
            evidence_details = dom_automation.get("details", [])
        blocked.append(
            {
                "scope": "anchor-dom-evidence",
                "status": anchor_dom_gate["status"],
                "proofStatus": anchor_dom_gate["proofStatus"],
                "reason": anchor_dom_gate["reason"],
                "evidencePath": anchor_dom_gate.get("evidencePath"),
                "evidenceStatus": anchor_dom_gate.get("evidenceStatus"),
                "sourceArtifact": source_trace.get("sourceArtifact") or dom_automation.get("path"),
                **source_trace,
                "evidenceDetails": evidence_details,
                "issue_breakdown": issue_breakdown,
                "issueBreakdown": anchor_dom_gate.get("issueBreakdown", []),
                "recommended_review_commands": anchor_dom_gate.get("recommended_review_commands", []),
                "recommendedReviewCommands": anchor_dom_gate.get("recommendedReviewCommands", []),
            }
        )
    react_commits = react_commit_aggregation(station_report)
    store_updates = store_update_aggregation(station_report)
    overlays = overlay_latency_aggregation(station_report)
    invokes = invoke_aggregation(station_report)
    main_thread = main_thread_exception_summary(station_report)
    interaction_correlation = interaction_correlation_summary(station_report)
    for aggregation_key, aggregation in (
        ("reactCommitAggregation", react_commits),
        ("storeUpdateAggregation", store_updates),
        ("overlayLatencyAggregation", overlays),
        ("invokeAggregation", invokes),
        ("mainThreadExceptions", main_thread),
    ):
        reason = aggregation_blocked_reason(aggregation_key, aggregation, station_evidence, station_mirror_source)
        if reason is not None:
            blocked.append(reason)
    if interaction_correlation["status"] != "loaded":
        issue_breakdown = issue_breakdown_for_blocked_scope(
            INTERACTION_CORRELATION_TRACE["scope"],
            interaction_correlation["reason"],
            "P0b-2/P0c-5 remains PARTIAL/UNPROVEN until interaction-correlated events carry interactionId.",
        )
        review_commands = report_review_commands()
        blocked.append(
            {
                "scope": "interaction-correlation",
                "status": interaction_correlation["status"],
                "proofStatus": interaction_correlation["proofStatus"],
                "reason": interaction_correlation["reason"],
                "evidencePath": station_evidence["path"],
                "evidenceStatus": station_evidence["status"],
                "sourceArtifact": station_evidence["path"],
                "sourceArtifactKind": station_mirror_source.get("artifactKind") or MIRROR_REQUIRED_ARTIFACT_KIND,
                "sourcePhase": INTERACTION_CORRELATION_TRACE["phase"],
                "sourceBom": INTERACTION_CORRELATION_TRACE["bom"],
                "sourceSpec": INTERACTION_CORRELATION_TRACE["spec"],
                "sourceGate": INTERACTION_CORRELATION_TRACE["gate"],
                "completionStatus": station_mirror_source.get("completionStatus", "PARTIAL"),
                "sourceProofStatus": station_mirror_source.get("proofStatus", "UNPROVEN"),
                "unlinkedEventCount": interaction_correlation["unlinkedEventCount"],
                "evidenceDetails": [
                    {
                        "aggregationKey": "interactionCorrelation",
                        "status": interaction_correlation["status"],
                        "proofStatus": interaction_correlation["proofStatus"],
                        "reason": interaction_correlation["reason"],
                        "unlinkedEventCount": interaction_correlation["unlinkedEventCount"],
                        "evidencePath": station_evidence["path"],
                        "evidenceStatus": station_evidence["status"],
                    }
                ],
                "issue_breakdown": issue_breakdown,
                "issueBreakdown": issue_breakdown,
                "recommended_review_commands": review_commands,
                "recommendedReviewCommands": review_commands,
            }
        )
    red_line_state = (
        matrix_report.get("redLinePolicy")
        if isinstance(matrix_report, dict)
        else {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "reason": "missing matrix report",
        }
    )
    matrix_state = (
        {
            "status": matrix_report.get("status"),
            "completionStatus": matrix_report.get("completionStatus"),
            "proofStatus": matrix_report.get("proofStatus", "UNPROVEN"),
            "failClosed": matrix_report.get("failClosed", {}),
            "summary": matrix_report.get("summary", {}),
            "cells": matrix_report.get("cells", []),
            "preflightState": matrix_report.get("preflightState"),
            "browserGatewayPreflightState": matrix_report.get("browserGatewayPreflightState"),
            "browserGatewayDomEvidenceState": matrix_report.get("browserGatewayDomEvidenceState"),
            "stationTelemetryRouteProbeState": matrix_report.get("stationTelemetryRouteProbeState"),
            "stationTelemetryDbSchemaState": matrix_report.get("stationTelemetryDbSchemaState"),
            "stationTelemetryLocalLoopState": matrix_report.get("stationTelemetryLocalLoopState"),
            "stationTelemetryRuntimeClosureState": matrix_report.get("stationTelemetryRuntimeClosureState"),
            "localTelemetryBufferState": normalize_local_buffer_state(matrix_report.get("localTelemetryBufferState")),
        }
        if isinstance(matrix_report, dict)
        else {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "summary": {},
        }
    )
    has_matrix_reason = any(
        item.get("scope") == "matrix"
        or str(item.get("scope", "")).startswith("matrix:")
        or str(item.get("scope", "")).startswith("red-line:")
        for item in blocked
    )
    if matrix_state["status"] != "pass" and not has_matrix_reason:
        blocked.append(
            {
                "scope": "matrix",
                "status": matrix_state["status"] or "diagnostic incomplete",
                "proofStatus": matrix_state.get("proofStatus", "UNPROVEN"),
                "reason": (
                    matrix_report.get("reason")
                    if isinstance(matrix_report, dict)
                    else f"missing matrix report: {matrix_evidence['path']}"
                )
                or "matrix artifact status is not pass",
                "evidencePath": matrix_evidence["path"],
                "evidenceStatus": matrix_evidence["status"],
                "sampleEmissionAllowed": False,
            }
        )
    blocked = normalize_blocked_reasons(blocked)
    status = "pass"
    if (
        station_report is None
        or preflight["status"] != "pass"
        or station_mirror_source["status"] != "loaded"
        or matrix_state["status"] != "pass"
        or anchor_source_gate["status"] != "pass"
        or anchors["status"] != "pass"
        or anchor_dom_gate["status"] != "pass"
        or sampler_gate["status"] != "pass"
        or red_line_state.get("status") != "pass"
        or react_commits["status"] != "loaded"
        or store_updates["status"] != "loaded"
        or overlays["status"] != "loaded"
        or invokes["status"] != "loaded"
        or main_thread["status"] != "loaded"
        or interaction_correlation["status"] != "loaded"
    ):
        status = "diagnostic incomplete"
    report = {
        "schemaVersion": 1,
        "artifactKind": REPORT_ARTIFACT_KIND,
        "sourceArtifactKind": REPORT_ARTIFACT_KIND,
        "sourcePhase": REPORT_PHASE,
        "sourceBom": list(REPORT_BOM),
        "sourceSpec": list(REPORT_SPEC),
        "sourceGate": REPORT_GATE,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": status == "pass",
        "phase": REPORT_PHASE,
        "bom": list(REPORT_BOM),
        "spec": list(REPORT_SPEC),
        "gate": REPORT_GATE,
        "plan": {
            "task": "P0c-5",
            "bom": ["BOM-RUN-05", "BOM-CAP-05"],
            "spec": ["SPEC-MIRROR-01", "SPEC-STA-03"],
            "gate": "Reports include raw events, p50/p95, blocked reason, and red-line state",
        },
        "stationQueryKey": station_query_key(station_report, station_evidence),
        "preflightState": preflight,
        "stationMirror": station_summary(station_report),
        "stationMirrorSource": station_mirror_source,
        "matrix": matrix_state,
        "anchorSourceGate": anchor_source_gate,
        "anchorInventory": anchors,
        "anchorDomEvidenceGate": anchor_dom_gate,
        "samplerGate": sampler_gate,
        "redLineState": red_line_state,
        "reactCommitAggregation": react_commits,
        "storeUpdateAggregation": store_updates,
        "overlayLatencyAggregation": overlays,
        "invokeAggregation": invokes,
        "mainThreadExceptions": main_thread,
        "interactionCorrelation": interaction_correlation,
        "rollups": rollup_summary(station_report),
        "rawEvents": {
            "path": station_evidence["path"],
            "count": 0 if station_report is None else len(station_report.get("events", [])),
        },
        "blockedReasons": blocked,
        "artifacts": {
            "stationMirror": station_evidence,
            "preflight": preflight_evidence,
            "matrix": matrix_evidence,
            "anchorSourceGate": anchor_source_gate_evidence,
            "anchorInventory": anchor_evidence,
            "anchorDomEvidenceGate": anchor_dom_gate_evidence,
            "samplerGate": sampler_gate_evidence,
        },
    }
    if status != "pass":
        issue_breakdown = report_issue_breakdown(blocked)
        review_commands = report_recommended_review_commands(blocked)
        report["issue_breakdown"] = issue_breakdown
        report["issueBreakdown"] = issue_breakdown
        primary_issue = primary_issue_summary(issue_breakdown)
        if primary_issue:
            report.update({key: value for key, value in primary_issue.items() if key in {"failedStep", "reason"}})
        report["recommended_review_commands"] = review_commands
        report["recommendedReviewCommands"] = review_commands
    report["summary"] = report_summary(report)
    if status != "pass":
        primary_issue = primary_issue_summary(report.get("issue_breakdown", []))
        if primary_issue:
            report["summary"].update(primary_issue)
    report = normalize_embedded_issue_breakdowns(report)
    return report


def render_markdown(report: dict[str, Any]) -> str:
    browser_gateway_preflight_state = report.get("matrix", {}).get("browserGatewayPreflightState") or {}
    browser_gateway_dom_evidence_state = report.get("matrix", {}).get("browserGatewayDomEvidenceState") or {}
    browser_gateway_dom_runtime_context = browser_gateway_dom_evidence_state.get("runtimeContext") or {}
    db_schema_state = report.get("matrix", {}).get("stationTelemetryDbSchemaState") or {}
    local_loop_state = report.get("matrix", {}).get("stationTelemetryLocalLoopState") or {}
    local_buffer_state = report.get("matrix", {}).get("localTelemetryBufferState") or {}
    lines = [
        "# Desktop Performance Report",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Status: `{report['status']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Plan task: `{report['plan']['task']}`",
        f"- BOM: `{', '.join(report['plan']['bom'])}`",
        f"- Spec: `{', '.join(report['plan']['spec'])}`",
        f"- Gate: `{report['plan']['gate']}`",
        f"- Source kind: `{report.get('sourceArtifactKind')}`",
        f"- Source phase: `{report.get('sourcePhase')}`",
        f"- Source BOM: `{format_markdown_list(report.get('sourceBom'))}`",
        f"- Source Spec: `{format_markdown_list(report.get('sourceSpec'))}`",
        f"- Source Gate: `{report.get('sourceGate')}`",
        "",
        "## Report Summary",
        "",
        f"- Sample emission allowed: `{report.get('summary', {}).get('sampleEmissionAllowed')}`",
        f"- Blocked reasons: `{report.get('summary', {}).get('blockedReasonCount')}`",
        f"- Issues: `{report.get('summary', {}).get('issueCount')}`",
        f"- Unproven scopes: `{report.get('summary', {}).get('unprovenScopeCount')}`",
        f"- Station route probe: `{report.get('summary', {}).get('stationTelemetryRouteProbeStatus')}`",
        f"- Station route proof trusted: `{report.get('summary', {}).get('stationTelemetryRouteProofTrusted')}`",
        f"- Station route runtime closure proof: `{report.get('summary', {}).get('stationTelemetryRouteRuntimeClosureProofStatus')}`",
        f"- Station route runtime closure sample emission allowed: `{report.get('summary', {}).get('stationTelemetryRouteRuntimeClosureSampleEmissionAllowed')}`",
          f"- Station route runtime closure Docker daemon proof: `{report.get('summary', {}).get('stationTelemetryRouteRuntimeClosureDockerDaemonProofStatus')}`",
          f"- Station route runtime closure failed check reasons: `{json.dumps(report.get('summary', {}).get('stationTelemetryRouteRuntimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
          f"- Station route runtime closure local closure proof: `{(report.get('summary', {}).get('stationTelemetryRouteRuntimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
          f"- Station route runtime closure compose closure proof: `{(report.get('summary', {}).get('stationTelemetryRouteRuntimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        f"- App gateway preflight runtime closure proof: `{report.get('summary', {}).get('appGatewayPreflightRuntimeClosureProofStatus')}`",
        f"- App gateway preflight runtime closure sample emission allowed: `{report.get('summary', {}).get('appGatewayPreflightRuntimeClosureSampleEmissionAllowed')}`",
        f"- App gateway preflight runtime closure blocked step: `{report.get('summary', {}).get('appGatewayPreflightRuntimeClosureBlockedStep')}`",
          f"- App gateway preflight runtime closure failed check reasons: `{json.dumps(report.get('summary', {}).get('appGatewayPreflightRuntimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
          f"- App gateway preflight runtime closure local closure proof: `{(report.get('summary', {}).get('appGatewayPreflightRuntimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
          f"- App gateway preflight runtime closure compose closure proof: `{(report.get('summary', {}).get('appGatewayPreflightRuntimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        f"- Station route required routes: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRouteRequiredRoutes'))}`",
        f"- Station route local source routes: `{report.get('summary', {}).get('stationTelemetryRouteLocalSourceRegisteredRouteCount')}/{report.get('summary', {}).get('stationTelemetryRouteRequiredRouteCount')}`",
        f"- Station route target runtime routes: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeRegisteredRouteCount')}/{report.get('summary', {}).get('stationTelemetryRouteRequiredRouteCount')}`",
        f"- Station route target missing routes: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeMissingRoutes'))}`",
        f"- Station route target handler count: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeHandlerCount')}`",
        f"- Station route local source contract proof: `{report.get('summary', {}).get('stationTelemetryRouteLocalSourceRouteContractProofStatus')}`",
        f"- Station route local deployable source proof: `{report.get('summary', {}).get('stationTelemetryRouteLocalSourceDeploymentProofStatus')}`",
        f"- Station route local deployable source reason: `{report.get('summary', {}).get('stationTelemetryRouteLocalSourceDeploymentReason')}`",
        f"- Station route local deployable HEAD contract proof: `{report.get('summary', {}).get('stationTelemetryRouteLocalSourceHeadRouteContractProofStatus')}`",
        f"- Station route local deployable dirty paths: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRouteLocalSourceDirtyRelevantPaths'))}`",
        f"- Station route local deployable untracked paths: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRouteLocalSourceUntrackedRelevantPaths'))}`",
        f"- Station route target contract proof: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeRouteContractProofStatus')}`",
        f"- Station route target missing contracts: `{format_route_contracts(report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeMissingRouteContracts'))}`",
        f"- Station route target build commit: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeBuildCommit')}`",
        f"- Station route target build label: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeBuildLabel')}`",
        f"- Station route target build time: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeBuildTime')}`",
        f"- Station route target identity proof: `{report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeIdentityProofStatus')}`",
        f"- Station route target identity missing fields: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRouteTargetRuntimeIdentityMissingFields'))}`",
        f"- Station local loop: `{report.get('summary', {}).get('stationTelemetryLocalLoopStatus')}`",
        f"- Station local loop gateway upload source: `{report.get('summary', {}).get('stationTelemetryLocalLoopGatewayUploadSourceStatus')}`",
        f"- Station local loop gateway upload source proof: `{report.get('summary', {}).get('stationTelemetryLocalLoopGatewayUploadSourceProofStatus')}`",
        f"- Station local loop gateway upload source failed requirements: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryLocalLoopGatewayUploadSourceFailedRequirements'))}`",
        f"- Station runtime closure: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureStatus')}`",
        f"- Station runtime closure proof: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureProofStatus')}`",
        f"- Station runtime closure managed runtime: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureManagedRuntime')}`",
        f"- Station runtime closure local proof: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureLocalProofStatus')}`",
        f"- Station runtime closure compose proof: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureComposeProofStatus')}`",
        f"- Station runtime closure Docker daemon proof: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureDockerDaemonProofStatus')}`",
        f"- Station runtime closure failed checks: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRuntimeClosureFailedChecks'))}`",
        f"- Station runtime closure failed step: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureFailedStep')}`",
        f"- Station runtime closure blocked step: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureBlockedStep')}`",
        f"- Station runtime closure blocked downstream steps: `{format_markdown_list(report.get('summary', {}).get('stationTelemetryRuntimeClosureBlockedDownstreamSteps'))}`",
        f"- Station runtime closure blocked downstream proof count: `{report.get('summary', {}).get('stationTelemetryRuntimeClosureBlockedDownstreamProofCount')}`",
        f"- Local telemetry buffer: `{report.get('summary', {}).get('localTelemetryBufferStatus')}`",
        f"- Local telemetry buffer observation template: `{report.get('summary', {}).get('localTelemetryBufferObservationTemplateJsonPath')}`",
        f"- Local telemetry buffer observation template Markdown: `{report.get('summary', {}).get('localTelemetryBufferObservationTemplateMarkdownPath')}`",
        f"- Local telemetry buffer source: `{report.get('summary', {}).get('localTelemetryBufferObservationActualSource')}`",
        f"- Local telemetry buffer source proof: `{report.get('summary', {}).get('localTelemetryBufferObservationSourceProofStatus')}`",
        f"- Local telemetry buffer consistency: `{report.get('summary', {}).get('localTelemetryBufferObservationConsistencyStatus')}`",
        f"- Local telemetry buffer retention window: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowStatus')}`",
        f"- Local telemetry buffer retention max events: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowMaxEvents')}`",
        f"- Local telemetry buffer retention capacity proven: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowCapacityProven')}`",
        f"- Local telemetry buffer total observed or dropped: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowTotalObservedOrDroppedCount')}`",
        f"- Local telemetry buffer drop ratio: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowDropRatio')}`",
        f"- Local telemetry buffer dropped byKind sum: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowDroppedByKindCountSum')}`",
        f"- Local telemetry buffer dropped withInteraction sum: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowDroppedWithInteractionCountSum')}`",
        f"- Local telemetry buffer dropped kind attribution proven: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowDroppedKindAttributionProven')}`",
        f"- Local telemetry buffer dropped interaction attribution valid: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid')}`",
        f"- Local telemetry buffer tail only: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowTailWindowOnly')}`",
          f"- Local telemetry buffer retention reason: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowReason')}`",
          f"- Local telemetry buffer dropped byKind: `{json.dumps(report.get('summary', {}).get('localTelemetryBufferDroppedByKind') or {}, sort_keys=True, ensure_ascii=False)}`",
          f"- Local telemetry buffer dropped withInteraction: `{json.dumps(report.get('summary', {}).get('localTelemetryBufferDroppedWithInteraction') or {}, sort_keys=True, ensure_ascii=False)}`",
        f"- Sampler local telemetry buffer: `{report.get('summary', {}).get('samplerLocalTelemetryBufferStatus')}`",
        f"- Sampler local telemetry buffer proof: `{report.get('summary', {}).get('samplerLocalTelemetryBufferProofStatus')}`",
        f"- Sampler local telemetry buffer sample emission allowed: `{report.get('summary', {}).get('samplerLocalTelemetryBufferSampleEmissionAllowed')}`",
        f"- Sampler local telemetry buffer missing observation fields: `{format_markdown_list(report.get('summary', {}).get('samplerLocalTelemetryBufferMissingObservationFields'))}`",
        f"- Sampler local telemetry buffer observation template JSON: `{report.get('summary', {}).get('samplerLocalTelemetryBufferObservationTemplateJsonPath')}`",
        f"- Station DB schema: `{report.get('summary', {}).get('stationTelemetryDbSchemaStatus')}`",
        f"- Station DB migration policy: `{report.get('summary', {}).get('stationTelemetryDbSchemaMigrationPolicy')}`",
        f"- Station DB versioned migration status: `{report.get('summary', {}).get('stationTelemetryDbSchemaVersionedMigrationStatus')}`",
        f"- App gateway preflight: `{report.get('summary', {}).get('appGatewayPreflightStatus')}`",
        f"- App gateway preflight failed step: `{report.get('summary', {}).get('appGatewayPreflightFailedStep')}`",
        f"- Browser gateway preflight: `{report.get('summary', {}).get('browserGatewayPreflightStatus')}`",
        f"- Browser gateway live telemetry: `{report.get('summary', {}).get('browserGatewayLiveStatus')}`",
        f"- Browser gateway live source kind: `{report.get('summary', {}).get('browserGatewayLiveSourceArtifactKind')}`",
        f"- Browser gateway live source phase: `{report.get('summary', {}).get('browserGatewayLiveSourcePhase')}`",
        f"- Browser gateway live source BOM: `{format_markdown_list(report.get('summary', {}).get('browserGatewayLiveSourceBom'))}`",
        f"- Browser gateway live source Spec: `{format_markdown_list(report.get('summary', {}).get('browserGatewayLiveSourceSpec'))}`",
        f"- Browser gateway live failed step: `{report.get('summary', {}).get('browserGatewayLiveFailedStep')}`",
        f"- Browser gateway live blocked step: `{report.get('summary', {}).get('browserGatewayLiveBlockedStep')}`",
        f"- Browser gateway live blocked phase: `{report.get('summary', {}).get('browserGatewayLiveBlockedPhase')}`",
        f"- Browser gateway live blocked by step: `{report.get('summary', {}).get('browserGatewayLiveBlockedByStep')}`",
        f"- Browser gateway live blocked by phase: `{report.get('summary', {}).get('browserGatewayLiveBlockedByPhase')}`",
        f"- Browser gateway live blocked by gate: `{report.get('summary', {}).get('browserGatewayLiveBlockedByGate')}`",
        f"- Browser gateway live blocked downstream steps: `{format_markdown_list(report.get('summary', {}).get('browserGatewayLiveBlockedDownstreamSteps'))}`",
        f"- Browser gateway live runtime closure proof: `{report.get('summary', {}).get('browserGatewayLiveRuntimeClosureProofStatus')}`",
        f"- Browser gateway live runtime closure sample emission allowed: `{report.get('summary', {}).get('browserGatewayLiveRuntimeClosureSampleEmissionAllowed')}`",
        f"- Browser gateway live runtime closure Docker daemon proof: `{report.get('summary', {}).get('browserGatewayLiveRuntimeClosureDockerDaemonProofStatus')}`",
        f"- Browser gateway live runtime closure failed check reasons: `{json.dumps(report.get('summary', {}).get('browserGatewayLiveRuntimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
        f"- Browser gateway live runtime closure local closure proof: `{(report.get('summary', {}).get('browserGatewayLiveRuntimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
        f"- Browser gateway live runtime closure compose closure proof: `{(report.get('summary', {}).get('browserGatewayLiveRuntimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        f"- Browser gateway live runtime closure blocked downstream proof count: `{report.get('summary', {}).get('browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount')}`",
        f"- Browser gateway live target build commit: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeBuildCommit')}`",
        f"- Browser gateway live target build label: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeBuildLabel')}`",
        f"- Browser gateway live target build time: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeBuildTime')}`",
        f"- Browser gateway live target identity proof: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeIdentityProofStatus')}`",
        f"- Browser gateway live target identity missing fields: `{format_markdown_list(report.get('summary', {}).get('browserGatewayLiveTargetRuntimeIdentityMissingFields'))}`",
        f"- Browser gateway live target route evidence source: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourceKind')}`",
        f"- Browser gateway live target route evidence source artifact: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourceArtifact')}`",
        f"- Browser gateway live target route evidence source phase: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourcePhase')}`",
        f"- Browser gateway live target route evidence source BOM: `{format_markdown_list(report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourceBom'))}`",
        f"- Browser gateway live target route evidence source Spec: `{format_markdown_list(report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourceSpec'))}`",
        f"- Browser gateway live target route evidence source Gate: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourceGate')}`",
        f"- Browser gateway live target route evidence source reason: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteEvidenceSourceReason')}`",
        f"- Browser gateway live target route contract proof: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeRouteContractProofStatus')}`",
        f"- Browser gateway live target route contracts: `{report.get('summary', {}).get('browserGatewayLiveTargetRuntimeMatchedRouteContractCount')}/{(report.get('summary', {}).get('browserGatewayLiveTargetRuntimeMatchedRouteContractCount') or 0) + (report.get('summary', {}).get('browserGatewayLiveTargetRuntimeMissingRouteContractCount') or 0)}`",
        f"- Browser gateway live target missing route contracts: `{format_route_contracts(report.get('summary', {}).get('browserGatewayLiveTargetRuntimeMissingRouteContracts'))}`",
        f"- Browser gateway DOM evidence: `{report.get('summary', {}).get('browserGatewayDomEvidenceStatus')}`",
        f"- Matrix sampled cells: `{report.get('summary', {}).get('matrixSampledCells')}`",
        f"- Matrix blocked cells: `{report.get('summary', {}).get('matrixBlockedCells')}`",
        f"- Matrix diagnostic incomplete cells: `{report.get('summary', {}).get('matrixDiagnosticIncompleteCells')}`",
        f"- Matrix unproven runtime cells: `{report.get('summary', {}).get('matrixUnprovenRuntimeCells')}`",
        f"- Sampler gate: `{report.get('summary', {}).get('samplerGateStatus')}`",
        f"- Sampler DOM anchor gate: `{report.get('summary', {}).get('samplerDomAnchorGateStatus')}`",
        f"- Sampler DOM anchor proof: `{report.get('summary', {}).get('samplerDomAnchorGateProofStatus')}`",
        f"- Sampler DOM anchor blocked by steps: `{format_markdown_list(report.get('summary', {}).get('samplerDomAnchorBlockedBySteps'))}`",
        f"- Sampler DOM anchor blocked downstream steps: `{format_markdown_list(report.get('summary', {}).get('samplerDomAnchorBlockedDownstreamSteps'))}`",
        f"- Sampler runtime closure proof: `{report.get('summary', {}).get('samplerRuntimeClosureProofStatus')}`",
        f"- Sampler runtime closure sample emission allowed: `{report.get('summary', {}).get('samplerRuntimeClosureSampleEmissionAllowed')}`",
        f"- Sampler runtime closure Docker daemon proof: `{report.get('summary', {}).get('samplerRuntimeClosureDockerDaemonProofStatus')}`",
        f"- Red-line: `{report.get('summary', {}).get('redLineStatus')}`",
        "",
        "## Input Artifacts",
        "",
        "| Artifact | Status | Path | Count |",
        "|---|---|---|---:|",
        "| `stationMirror` | `{station_status}` | `{station_path}` | `{station_count}` |".format(
            station_status=report["artifacts"]["stationMirror"].get("status"),
            station_path=report["artifacts"]["stationMirror"].get("path"),
            station_count=report["stationMirror"]["eventCount"],
        ),
        "| `preflight` | `{preflight_status}` | `{preflight_path}` | `n/a` |".format(
            preflight_status=report["artifacts"]["preflight"].get("status"),
            preflight_path=report["artifacts"]["preflight"].get("path"),
        ),
        "| `matrix` | `{matrix_status}` | `{matrix_path}` | `n/a` |".format(
            matrix_status=report["artifacts"]["matrix"].get("status"),
            matrix_path=report["artifacts"]["matrix"].get("path"),
        ),
        "| `anchorSourceGate` | `{anchor_source_status}` | `{anchor_source_path}` | `{anchor_source_count}` |".format(
            anchor_source_status=report["artifacts"]["anchorSourceGate"].get("status"),
            anchor_source_path=report["artifacts"]["anchorSourceGate"].get("path"),
            anchor_source_count="{}/{}".format(
                report["anchorSourceGate"].get("presentCount"),
                report["anchorSourceGate"].get("requiredCount"),
            ),
        ),
        "| `anchorInventory` | `{anchor_status}` | `{anchor_path}` | `n/a` |".format(
            anchor_status=report["artifacts"]["anchorInventory"].get("status"),
            anchor_path=report["artifacts"]["anchorInventory"].get("path"),
        ),
        "| `anchorDomEvidenceGate` | `{anchor_dom_status}` | `{anchor_dom_path}` | `n/a` |".format(
            anchor_dom_status=report["artifacts"]["anchorDomEvidenceGate"].get("status"),
            anchor_dom_path=report["artifacts"]["anchorDomEvidenceGate"].get("path"),
        ),
        "| `samplerGate` | `{sampler_status}` | `{sampler_path}` | `{sampler_count}` |".format(
            sampler_status=report["artifacts"]["samplerGate"].get("status"),
            sampler_path=report["artifacts"]["samplerGate"].get("path"),
            sampler_count=report["samplerGate"].get("samplerCount"),
        ),
        "| `rawEvents` | `{station_status}` | `{raw_path}` | `{raw_count}` |".format(
            station_status=report["artifacts"]["stationMirror"].get("status"),
            raw_path=report["rawEvents"].get("path"),
            raw_count=report["rawEvents"].get("count"),
        ),
        "",
        "## Matrix State",
        "",
        f"- Status: `{report['matrix']['status']}`",
        f"- Completion: `{report['matrix'].get('completionStatus')}`",
        f"- Proof: `{report['matrix'].get('proofStatus')}`",
        f"- Sampled cells: `{report['matrix'].get('summary', {}).get('sampled', 0)}`",
        f"- Blocked cells: `{report['matrix'].get('failClosed', {}).get('blockedCellCount', 0)}`",
        "",
        "## Runtime Preflight",
        "",
        f"- Status: `{report['preflightState']['status']}`",
        f"- Proof: `{report['preflightState']['proofStatus']}`",
        f"- Source phase: `{report['preflightState'].get('phase')}`",
        f"- Source kind: `{report['preflightState'].get('artifactKind')}`",
        f"- Gateway: `{report['preflightState'].get('gateway')}`",
        f"- Station: `{report['preflightState'].get('station')}`",
        f"- Failed step: `{report['preflightState'].get('failedStep')}`",
        f"- Check count: `{report['preflightState'].get('checkCount')}`",
        f"- Passed checks: `{report['preflightState'].get('passedCheckCount')}`",
        f"- Failed checks: `{report['preflightState'].get('failedCheckCount')}`",
        f"- Failed check names: `{format_markdown_list(report['preflightState'].get('failedChecks'))}`",
        f"- Station health: `{report['preflightState'].get('stationHealthStatus')}`",
        f"- Desktop gateway: `{report['preflightState'].get('desktopGatewayStatus')}`",
        f"- Sample emission allowed: `{report['preflightState'].get('sampleEmissionAllowed')}`",
      f"- Runtime closure failed check reasons: `{json.dumps(report['preflightState'].get('runtimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
      f"- Runtime closure local closure proof: `{(report['preflightState'].get('runtimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
      f"- Runtime closure compose closure proof: `{(report['preflightState'].get('runtimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        f"- Reason: `{report['preflightState'].get('reason')}`",
        "",
        "## Browser Gateway Preflight",
        "",
        f"- Status: `{browser_gateway_preflight_state.get('status')}`",
        f"- Proof: `{browser_gateway_preflight_state.get('proofStatus')}`",
        f"- Source phase: `{browser_gateway_preflight_state.get('sourcePhase')}`",
        f"- Source kind: `{browser_gateway_preflight_state.get('sourceArtifactKind')}`",
        f"- Sample emission allowed: `{browser_gateway_preflight_state.get('sampleEmissionAllowed')}`",
      f"- Runtime closure failed check reasons: `{json.dumps(browser_gateway_preflight_state.get('runtimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
      f"- Runtime closure local closure proof: `{(browser_gateway_preflight_state.get('runtimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
      f"- Runtime closure compose closure proof: `{(browser_gateway_preflight_state.get('runtimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        f"- Reason: `{browser_gateway_preflight_state.get('reason')}`",
        "",
        "## Browser Gateway DOM Evidence",
        "",
        f"- Status: `{browser_gateway_dom_evidence_state.get('status')}`",
        f"- Proof: `{browser_gateway_dom_evidence_state.get('proofStatus')}`",
        f"- Source phase: `{browser_gateway_dom_evidence_state.get('sourcePhase')}`",
        f"- Source kind: `{browser_gateway_dom_evidence_state.get('sourceArtifactKind')}`",
        f"- Sample emission allowed: `{browser_gateway_dom_evidence_state.get('sampleEmissionAllowed')}`",
        f"- Reason: `{browser_gateway_dom_evidence_state.get('reason')}`",
        f"- Page state: `{browser_gateway_dom_runtime_context.get('pageState')}`",
        f"- Login submit observed: `{browser_gateway_dom_runtime_context.get('loginSubmitObserved')}`",
        f"- Loading observed during submit: `{browser_gateway_dom_runtime_context.get('loadingObservedDuringSubmit')}`",
        "",
        "## Station Mirror",
        "",
        f"- Status: `{report['stationMirror']['status']}`",
        f"- Source status: `{report['stationMirrorSource']['status']}`",
        f"- Source proof: `{report['stationMirrorSource']['proofStatus']}`",
        f"- Source phase: `{report['stationMirrorSource'].get('phase')}`",
        f"- Source kind: `{report['stationMirrorSource'].get('artifactKind')}`",
        f"- Source BOM: `{format_markdown_list(report['stationMirrorSource'].get('bom'))}`",
        f"- Source Spec: `{format_markdown_list(report['stationMirrorSource'].get('spec'))}`",
        f"- Source Gate: `{report['stationMirrorSource'].get('gate')}`",
        f"- Product sink: `{report['stationMirrorSource'].get('productSink')}`",
        f"- Mirror role: `{report['stationMirrorSource'].get('mirrorRole')}`",
        f"- Raw events: `{report['stationMirror']['eventCount']}`",
        f"- Rollups: `{report['stationMirror']['rollupCount']}`",
        f"- Max p95 duration: `{report['stationMirror']['maxP95DurationMs']}`",
        "",
        "## Anchor Inventory",
        "",
        f"- Source gate status: `{report['anchorSourceGate']['status']}`",
        f"- Source gate completion: `{report['anchorSourceGate']['completionStatus']}`",
        f"- Source gate proof: `{report['anchorSourceGate']['proofStatus']}`",
        f"- Source gate phase: `{report['anchorSourceGate'].get('phase')}`",
        f"- Source gate BOM: `{format_markdown_list(report['anchorSourceGate'].get('bom'))}`",
        f"- Source gate Spec: `{format_markdown_list(report['anchorSourceGate'].get('spec'))}`",
        f"- Source gate Gate: `{report['anchorSourceGate'].get('gate')}`",
        f"- Source gate anchors: `{report['anchorSourceGate'].get('presentCount')}/{report['anchorSourceGate'].get('requiredCount')}`",
        f"- Status: `{report['anchorInventory']['status']}`",
        f"- Completion: `{report['anchorInventory']['completionStatus']}`",
        f"- Proof: `{report['anchorInventory']['proofStatus']}`",
        f"- Source anchors: `{report['anchorInventory']['sourceAnchors']['presentCount']}/{report['anchorInventory']['sourceAnchors']['requiredCount']}`",
        f"- DOM automation: `{report['anchorInventory']['domAutomation']['status']}`",
        f"- DOM required/proven anchors: `{report['anchorInventory']['domAutomation'].get('provenCount')}/{report['anchorInventory']['domAutomation'].get('requiredCount')}`",
        f"- Browser anchors: `{report['anchorInventory']['domAutomation'].get('browser', {}).get('provenCount')}/{report['anchorInventory']['domAutomation'].get('browser', {}).get('requiredCount')}`",
        f"- Tauri anchors: `{report['anchorInventory']['domAutomation'].get('tauri', {}).get('provenCount')}/{report['anchorInventory']['domAutomation'].get('tauri', {}).get('requiredCount')}`",
        f"- Tauri missing anchors: `{format_markdown_list(report['anchorInventory']['domAutomation'].get('tauri', {}).get('missingAnchors'))}`",
        f"- DOM source phase: `{report['anchorInventory']['domAutomation'].get('sourcePhase', 'n/a')}`",
        f"- DOM source BOM: `{format_markdown_list(report['anchorInventory']['domAutomation'].get('sourceBom'))}`",
        f"- DOM source Spec: `{format_markdown_list(report['anchorInventory']['domAutomation'].get('sourceSpec'))}`",
        f"- DOM source Gate: `{report['anchorInventory']['domAutomation'].get('sourceGate', 'n/a')}`",
        f"- DOM evidence gate: `{report['anchorDomEvidenceGate']['status']}`",
        f"- DOM evidence proof: `{report['anchorDomEvidenceGate']['proofStatus']}`",
        f"- DOM evidence required/proven anchors: `{report['anchorDomEvidenceGate']['domAutomation'].get('provenCount')}/{report['anchorDomEvidenceGate']['domAutomation'].get('requiredCount')}`",
        f"- DOM evidence browser anchors: `{report['anchorDomEvidenceGate']['domAutomation'].get('browser', {}).get('provenCount')}/{report['anchorDomEvidenceGate']['domAutomation'].get('browser', {}).get('requiredCount')}`",
        f"- DOM evidence Tauri anchors: `{report['anchorDomEvidenceGate']['domAutomation'].get('tauri', {}).get('provenCount')}/{report['anchorDomEvidenceGate']['domAutomation'].get('tauri', {}).get('requiredCount')}`",
        f"- DOM evidence Tauri missing anchors: `{format_markdown_list(report['anchorDomEvidenceGate']['domAutomation'].get('tauri', {}).get('missingAnchors'))}`",
        f"- DOM evidence blocked step: `{report.get('summary', {}).get('anchorDomEvidenceBlockedStep')}`",
        f"- DOM evidence blocked phase: `{report.get('summary', {}).get('anchorDomEvidenceBlockedPhase')}`",
        f"- DOM evidence blocked by steps: `{format_markdown_list(report.get('summary', {}).get('anchorDomEvidenceBlockedBySteps'))}`",
        f"- DOM evidence blocked downstream steps: `{format_markdown_list(report.get('summary', {}).get('anchorDomEvidenceBlockedDownstreamSteps'))}`",
        f"- DOM evidence source phase: `{report['anchorDomEvidenceGate']['domAutomation'].get('sourcePhase', 'n/a')}`",
        f"- DOM evidence source BOM: `{format_markdown_list(report['anchorDomEvidenceGate']['domAutomation'].get('sourceBom'))}`",
        f"- DOM evidence source Spec: `{format_markdown_list(report['anchorDomEvidenceGate']['domAutomation'].get('sourceSpec'))}`",
        f"- DOM evidence source Gate: `{report['anchorDomEvidenceGate']['domAutomation'].get('sourceGate', 'n/a')}`",
        "",
        "## Desktop Local Telemetry Buffer",
        "",
        f"- Status: `{local_buffer_state.get('status')}`",
        f"- Completion: `{local_buffer_state.get('completionStatus')}`",
        f"- Proof: `{local_buffer_state.get('proofStatus')}`",
        f"- Source status: `{local_buffer_state.get('sourceStatus')}`",
        f"- Source artifact: `{local_buffer_state.get('sourceArtifact')}`",
        f"- Source kind: `{local_buffer_state.get('sourceArtifactKind')}`",
        f"- Source phase: `{local_buffer_state.get('sourcePhase')}`",
        f"- Source BOM: `{format_markdown_list(local_buffer_state.get('sourceBom'))}`",
        f"- Source Spec: `{format_markdown_list(local_buffer_state.get('sourceSpec'))}`",
        f"- Source Gate: `{local_buffer_state.get('sourceGate')}`",
        f"- Event count: `{local_buffer_state.get('eventCount')}`",
        f"- Dropped count: `{local_buffer_state.get('droppedCount')}`",
        f"- Observation template JSON: `{local_buffer_state.get('observationTemplateJsonPath')}`",
        f"- Observation template Markdown: `{local_buffer_state.get('observationTemplateMarkdownPath')}`",
        f"- Observation source: `{local_buffer_state.get('observationActualSource')}`",
        f"- Observation source proof: `{local_buffer_state.get('observationSourceProofStatus')}`",
        f"- Observation consistency: `{local_buffer_state.get('observationConsistencyStatus')}`",
        f"- Observation byKind count sum: `{local_buffer_state.get('observationByKindCountSum')}`",
        f"- Interaction event kinds: `{local_buffer_state.get('interactionEventKindCount')}`",
        f"- Proven families: `{format_markdown_list(local_buffer_state.get('provenFamilies'))}`",
        f"- Unproven families: `{format_markdown_list(local_buffer_state.get('unprovenFamilies'))}`",
        f"- Sample emission allowed: `{local_buffer_state.get('sampleEmissionAllowed')}`",
        f"- Reason: `{local_buffer_state.get('reason')}`",
        "",
        "## Sampler Gate",
        "",
        f"- Status: `{report['samplerGate']['status']}`",
        f"- Completion: `{report['samplerGate']['completionStatus']}`",
        f"- Proof: `{report['samplerGate']['proofStatus']}`",
        f"- Source phase: `{report['samplerGate'].get('phase')}`",
        f"- Source BOM: `{format_markdown_list(report['samplerGate'].get('bom'))}`",
        f"- Source Spec: `{format_markdown_list(report['samplerGate'].get('spec'))}`",
        f"- Source Gate: `{report['samplerGate'].get('gate')}`",
        f"- Sample emission allowed: `{report['samplerGate'].get('sampleEmissionAllowed')}`",
        f"- Samplers: `{report['samplerGate'].get('samplerCount')}`",
        f"- Proven samplers: `{report['samplerGate'].get('provenSamplerCount')}`",
        f"- Unproven samplers: `{report['samplerGate'].get('unprovenSamplerCount')}`",
        f"- Unproven sampler ids: `{format_markdown_list(report['samplerGate'].get('unprovenSamplers'))}`",
        f"- Blocked scopes: `{format_markdown_list(report['samplerGate'].get('blockedScopes'))}`",
        f"- DOM anchor gate: `{report['samplerGate'].get('domAnchorGateStatus')}`",
        f"- DOM anchor proof: `{report['samplerGate'].get('domAnchorGateProofStatus')}`",
        f"- DOM anchor blocked by steps: `{format_markdown_list(report['samplerGate'].get('domAnchorBlockedBySteps'))}`",
        f"- DOM anchor blocked downstream steps: `{format_markdown_list(report['samplerGate'].get('domAnchorBlockedDownstreamSteps'))}`",
        f"- Runtime closure proof: `{report['samplerGate'].get('runtimeClosureProofStatus')}`",
        f"- Runtime closure sample emission allowed: `{report['samplerGate'].get('runtimeClosureSampleEmissionAllowed')}`",
        f"- Runtime closure Docker daemon proof: `{report['samplerGate'].get('runtimeClosureDockerDaemonProofStatus')}`",
          f"- Runtime closure failed check reasons: `{json.dumps(report['samplerGate'].get('runtimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
          f"- Runtime closure local closure proof: `{(report['samplerGate'].get('runtimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
          f"- Runtime closure compose closure proof: `{(report['samplerGate'].get('runtimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        f"- Local telemetry buffer: `{report['samplerGate'].get('localTelemetryBufferStatus')}`",
        f"- Local telemetry buffer proof: `{report['samplerGate'].get('localTelemetryBufferProofStatus')}`",
        f"- Local telemetry buffer sample emission allowed: `{report['samplerGate'].get('localTelemetryBufferSampleEmissionAllowed')}`",
        f"- Local telemetry buffer missing observation fields: `{format_markdown_list(report['samplerGate'].get('localTelemetryBufferMissingObservationFields'))}`",
        f"- Local telemetry buffer observation template JSON: `{report['samplerGate'].get('localTelemetryBufferObservationTemplateJsonPath')}`",
        f"- Local telemetry buffer dropped count: `{report['samplerGate'].get('localTelemetryBufferDroppedCount')}`",
        f"- Reason: `{report['samplerGate'].get('reason')}`",
        f"- Details: `{format_markdown_list(report['samplerGate'].get('details', []))}`",
        "",
        "| Sampler | Status | Proof | Phase | Event count | Required events | Reason |",
        "|---|---|---|---|---:|---|---|",
        *[
            "| `{sampler}` | `{status}` | `{proof}` | `{phase}` | {event_count} | `{required}` | {reason} |".format(
                sampler=sampler.get("samplerId"),
                status=sampler.get("status"),
                proof=sampler.get("proofStatus"),
                phase=sampler.get("phase"),
                event_count=sampler.get("eventCount", "n/a"),
                required=format_markdown_list(sampler.get("requiredEventKinds")),
                reason=sampler.get("reason", ""),
            )
            for sampler in report["samplerGate"].get("samplers", [])
            if isinstance(sampler, dict)
        ],
        "",
        "## Red-line State",
        "",
        f"- Status: `{report['redLineState']['status']}`",
        f"- Completion: `{report['redLineState'].get('completionStatus')}`",
        f"- Proof: `{report['redLineState'].get('proofStatus')}`",
        f"- Policy count: `{report['summary'].get('redLinePolicyCount')}`",
        f"- Passed policies: `{report['summary'].get('redLinePolicyPassedCount')}`",
        f"- Failed policies: `{report['summary'].get('redLinePolicyFailedCount')}`",
        f"- Diagnostic incomplete policies: `{report['summary'].get('redLinePolicyDiagnosticIncompleteCount')}`",
        f"- Policy ids: `{format_markdown_list([policy.get('policyId') for policy in report['summary'].get('redLinePolicySummaries', []) if isinstance(policy, dict)])}`",
        "",
        "## Red-line Policies",
        "",
        "| Policy | Scope | Status | Proof | Matched interactions | Window count | Raw evidence status | Raw evidence path | Raw source kind | Raw source phase | Raw source BOM | Raw source Spec | Raw source Gate | Sample blockers | Raw details | Reason |",
        "|---|---|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|",
        *[
            "| `{policy}` | {scope} | `{status}` | `{proof}` | `{matched}` | {window_count} | `{evidence_status}` | `{evidence_path}` | `{source_kind}` | `{source_phase}` | `{source_bom}` | `{source_spec}` | `{source_gate}` | `{sample_blockers}` | `{details}` | {reason} |".format(
                policy=policy.get("policyId"),
                scope=policy.get("scope"),
                status=policy.get("status"),
                proof=policy.get("proofStatus"),
                matched=format_markdown_list(policy.get("matchedInteractionIds")),
                window_count=policy.get("interactionWindowCount", "n/a"),
                evidence_status=(
                    policy.get("rawEvidence", {}).get("status", "n/a")
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                evidence_path=(
                    policy.get("rawEvidence", {}).get("path", "n/a")
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                source_phase=(
                    policy.get("rawEvidence", {}).get("sourcePhase", "n/a")
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                source_kind=(
                    policy.get("rawEvidence", {}).get("sourceArtifactKind", "n/a")
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                source_bom=(
                    format_markdown_list(policy.get("rawEvidence", {}).get("sourceBom"))
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                source_spec=(
                    format_markdown_list(policy.get("rawEvidence", {}).get("sourceSpec"))
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                source_gate=(
                    policy.get("rawEvidence", {}).get("sourceGate", "n/a")
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                details=(
                    format_markdown_list(policy.get("rawEvidence", {}).get("details"))
                    if isinstance(policy.get("rawEvidence"), dict)
                    else "n/a"
                ),
                sample_blockers=format_red_line_sample_blockers(policy.get("sampleBlockers")),
                reason=policy.get("reason"),
            )
            for policy in report["redLineState"].get("policies", [])
        ],
        "",
        "## React Commit Aggregation",
        "",
        f"- Status: `{report['reactCommitAggregation']['status']}`",
        f"- Proof: `{report['reactCommitAggregation']['proofStatus']}`",
        f"- Commit count: `{report['reactCommitAggregation']['commitCount']}`",
        f"- Total duration: `{report['reactCommitAggregation']['totalDurationMs']}`",
        f"- Max duration: `{report['reactCommitAggregation']['maxDurationMs']}`",
        "",
        "## Store Update Aggregation",
        "",
        f"- Status: `{report['storeUpdateAggregation']['status']}`",
        f"- Proof: `{report['storeUpdateAggregation']['proofStatus']}`",
        f"- Update count: `{report['storeUpdateAggregation']['updateCount']}`",
        f"- Total duration: `{report['storeUpdateAggregation']['totalDurationMs']}`",
        f"- Max duration: `{report['storeUpdateAggregation']['maxDurationMs']}`",
        f"- Unknown attribution count: `{report['storeUpdateAggregation']['unknownAttributionCount']}`",
        "",
        "## Desktop Telemetry Local Loop",
        "",
        f"- Status: `{local_loop_state.get('status')}`",
        f"- Completion: `{local_loop_state.get('completionStatus')}`",
        f"- Proof: `{local_loop_state.get('proofStatus')}`",
        f"- Source kind: `{local_loop_state.get('sourceArtifactKind')}`",
        f"- Source artifact: `{local_loop_state.get('sourceArtifact')}`",
        f"- Source phase: `{local_loop_state.get('sourcePhase')}`",
        f"- Source BOM: `{format_markdown_list(local_loop_state.get('sourceBom'))}`",
        f"- Source Spec: `{format_markdown_list(local_loop_state.get('sourceSpec'))}`",
        f"- Source Gate: `{local_loop_state.get('sourceGate')}`",
        f"- Station ingest/query/rollup: `{local_loop_state.get('stationIngestQueryRollupStatus')}`",
        f"- Desktop envelope/queue: `{local_loop_state.get('desktopEnvelopeBoundedQueueStatus')}`",
        f"- Tauri/Gateway upload validation: `{local_loop_state.get('tauriGatewayUploadValidationStatus')}`",
        f"- Sample emission allowed: `{local_loop_state.get('sampleEmissionAllowed')}`",
        "",
        "## Station Telemetry DB Schema",
        "",
        f"- Status: `{db_schema_state.get('status')}`",
        f"- Completion: `{db_schema_state.get('completionStatus')}`",
        f"- Proof: `{db_schema_state.get('proofStatus')}`",
        f"- Source kind: `{db_schema_state.get('sourceArtifactKind')}`",
        f"- Source artifact: `{db_schema_state.get('sourceArtifact')}`",
        f"- Source phase: `{db_schema_state.get('sourcePhase')}`",
        f"- Source BOM: `{format_markdown_list(db_schema_state.get('sourceBom'))}`",
        f"- Source Spec: `{format_markdown_list(db_schema_state.get('sourceSpec'))}`",
        f"- Source Gate: `{db_schema_state.get('sourceGate')}`",
        f"- Migration policy: `{db_schema_state.get('migrationPolicy')}`",
        f"- Runtime migration proof: `{db_schema_state.get('runtimeMigrationProofStatus')}`",
        f"- Versioned migration status: `{db_schema_state.get('versionedMigrationStatus')}`",
        f"- Versioned migration proof: `{db_schema_state.get('versionedMigrationProofStatus')}`",
        "",
        "## Overlay Latency Aggregation",
        "",
        f"- Status: `{report['overlayLatencyAggregation']['status']}`",
        f"- Proof: `{report['overlayLatencyAggregation']['proofStatus']}`",
        f"- Intent count: `{report['overlayLatencyAggregation']['intentCount']}`",
        f"- Visible count: `{report['overlayLatencyAggregation']['visibleCount']}`",
        f"- Hidden count: `{report['overlayLatencyAggregation']['hiddenCount']}`",
        f"- Paired visible count: `{report['overlayLatencyAggregation']['pairedVisibleCount']}`",
        f"- Missing visible count: `{report['overlayLatencyAggregation']['missingVisibleCount']}`",
        f"- Max visible latency: `{report['overlayLatencyAggregation']['maxVisibleLatencyMs']}`",
        "",
        "## Invoke Aggregation",
        "",
        f"- Status: `{report['invokeAggregation']['status']}`",
        f"- Proof: `{report['invokeAggregation']['proofStatus']}`",
        f"- Event count: `{report['invokeAggregation']['eventCount']}`",
        f"- Terminal count: `{report['invokeAggregation']['terminalCount']}`",
        f"- Failed count: `{report['invokeAggregation']['failedCount']}`",
        f"- Interaction invokes: `{report['invokeAggregation']['interactionInvokeCount']}`",
        f"- Startup invokes: `{report['invokeAggregation']['startupInvokeCount']}`",
        f"- Background invokes: `{report['invokeAggregation']['backgroundInvokeCount']}`",
        f"- Total duration: `{report['invokeAggregation']['totalDurationMs']}`",
        f"- Max duration: `{report['invokeAggregation']['maxDurationMs']}`",
        "",
        "## Interaction Correlation",
        "",
        f"- Status: `{report['interactionCorrelation']['status']}`",
        f"- Proof: `{report['interactionCorrelation']['proofStatus']}`",
        f"- Tracked events: `{report['interactionCorrelation']['trackedEventCount']}`",
        f"- Linked events: `{report['interactionCorrelation']['linkedEventCount']}`",
        f"- Unlinked events: `{report['interactionCorrelation']['unlinkedEventCount']}`",
        "",
        "## Main-thread Exceptions",
        "",
        f"- Status: `{report['mainThreadExceptions']['status']}`",
        f"- Proof: `{report['mainThreadExceptions']['proofStatus']}`",
        f"- Event count: `{report['mainThreadExceptions']['eventCount']}`",
        f"- Violations: `{report['mainThreadExceptions']['violationCount']}`",
        f"- Registered exceptions: `{report['mainThreadExceptions']['exceptionCount']}`",
        "",
        "## Rollups",
        "",
    ]
    if report["rollups"]:
        lines.append("| Module | Runtime | Kind | Count | p50 | p95 | Max |")
        lines.append("|---|---|---|---:|---:|---:|---:|")
        for rollup in report["rollups"]:
            lines.append(
                "| `{module}` | `{runtime}` | `{kind}` | {count} | {p50} | {p95} | {max_value} |".format(
                    module=rollup.get("module", ""),
                    runtime=rollup.get("runtime", ""),
                    kind=rollup.get("kind", ""),
                    count=rollup.get("count"),
                    p50=rollup.get("p50DurationMs"),
                    p95=rollup.get("p95DurationMs"),
                    max_value=rollup.get("maxDurationMs"),
                )
            )
    else:
        lines.append("- none")
    if report["reactCommitAggregation"]["windows"]:
        lines.extend(["", "## React Commit Windows", ""])
        lines.append("| Interaction | Owner | Source | Module | Count | Total | Max |")
        lines.append("|---|---|---|---|---:|---:|---:|")
        for window in report["reactCommitAggregation"]["windows"]:
            lines.append(
                "| `{interaction}` | `{owner}` | `{source}` | `{module}` | {count} | {total} | {max_value} |".format(
                    interaction=window.get("interactionId"),
                    owner=window.get("owner"),
                    source=window.get("source"),
                    module=window.get("module"),
                    count=window.get("commitCount"),
                    total=window.get("totalDurationMs"),
                    max_value=window.get("maxDurationMs"),
                )
            )
    if report["storeUpdateAggregation"]["stores"]:
        lines.extend(["", "## Store Update Windows", ""])
        lines.append("| Interaction | Store | Owner | Count | Total | Max | Fanout | Listener count | Changed keys |")
        lines.append("|---|---|---|---:|---:|---:|---|---|---|")
        for store in report["storeUpdateAggregation"]["stores"]:
            lines.append(
                "| `{interaction}` | `{store_name}` | `{owner}` | {count} | {total} | {max_value} | `{fanout}` | `{listener_count}` | `{changed}` |".format(
                    interaction=store.get("interactionId"),
                    store_name=store.get("store"),
                    owner=store.get("owner"),
                    count=store.get("updateCount"),
                    total=store.get("totalDurationMs"),
                    max_value=store.get("maxDurationMs"),
                    fanout=store.get("fanout"),
                    listener_count=store.get("listenerCount"),
                    changed=",".join(store.get("changedKeys", [])),
                )
            )
    if report["overlayLatencyAggregation"]["overlays"]:
        lines.extend(["", "## Overlay Latency Windows", ""])
        lines.append("| Interaction | Target | Surface | Intent | Visible | Hidden | Max visible latency | Status |")
        lines.append("|---|---|---|---:|---:|---:|---:|---|")
        for overlay in report["overlayLatencyAggregation"]["overlays"]:
            lines.append(
                "| `{interaction}` | `{target}` | `{surface}` | {intent} | {visible} | {hidden} | {latency} | `{status}` |".format(
                    interaction=overlay.get("interactionId"),
                    target=overlay.get("target"),
                    surface=overlay.get("surface"),
                    intent=overlay.get("intentCount"),
                    visible=overlay.get("visibleCount"),
                    hidden=overlay.get("hiddenCount"),
                    latency=overlay.get("visibleLatencyMs"),
                    status=overlay.get("status"),
                )
            )
    if report["invokeAggregation"]["commands"]:
        lines.extend(["", "## Invoke Windows", ""])
        lines.append("| Interaction | Command | Phase | Started | Completed | Failed | Total | Max | Quiet |")
        lines.append("|---|---|---|---:|---:|---:|---:|---:|---|")
        for command in report["invokeAggregation"]["commands"]:
            lines.append(
                "| `{interaction}` | `{command}` | `{phase}` | {started} | {completed} | {failed} | {total} | {max_value} | `{quiet}` |".format(
                    interaction=command.get("interactionId"),
                    command=command.get("command"),
                    phase=command.get("phase"),
                    started=command.get("startedCount"),
                    completed=command.get("completedCount"),
                    failed=command.get("failedCount"),
                    total=command.get("totalDurationMs"),
                    max_value=command.get("maxDurationMs"),
                    quiet=command.get("quiet"),
                )
            )
    if report["mainThreadExceptions"]["events"]:
        lines.extend(["", "## Main-thread Event Exceptions", ""])
        lines.append("| Kind | Interaction | Owner | Module | Duration | Threshold | Status | Exception |")
        lines.append("|---|---|---|---|---:|---:|---|---|")
        for event in report["mainThreadExceptions"]["events"]:
            exception = event.get("exception")
            exception_text = "none"
            if exception:
                exception_text = "owner={owner}; budget={budget}; expires={expires}".format(
                    owner=exception.get("owner"),
                    budget=exception.get("budgetMs"),
                    expires=exception.get("expiresAt"),
                )
            lines.append(
                "| `{kind}` | `{interaction}` | `{owner}` | `{module}` | {duration} | {threshold} | `{status}` | {exception} |".format(
                    kind=event.get("kind"),
                    interaction=event.get("interactionId"),
                    owner=event.get("owner"),
                    module=event.get("module"),
                    duration=event.get("durationMs"),
                    threshold=event.get("thresholdMs"),
                    status=event.get("status"),
                    exception=exception_text,
                )
            )
    if report["interactionCorrelation"]["unlinkedEvents"]:
        lines.extend(["", "## Unlinked Interaction Events", ""])
        lines.append("| Kind | Source | Module | Owner | Phase |")
        lines.append("|---|---|---|---|---|")
        for event in report["interactionCorrelation"]["unlinkedEvents"]:
            lines.append(
                "| `{kind}` | `{source}` | `{module}` | `{owner}` | `{phase}` |".format(
                    kind=event.get("kind"),
                    source=event.get("source"),
                    module=event.get("module"),
                    owner=event.get("owner"),
                    phase=event.get("phase"),
                )
            )
    lines.extend(["", "## Blocked Reasons", ""])
    if report["blockedReasons"]:
        for item in report["blockedReasons"]:
            source_text = ""
            if item.get("sourcePhase") or item.get("completionStatus"):
                source_text = " sourceArtifact=`{artifact}` sourceKind=`{kind}` sourcePhase=`{phase}` sourceCompletion=`{completion}` sourceProof=`{proof}` sourceBom=`{bom}` sourceSpec=`{spec}` sourceGate=`{gate}` sourceCell=`{cell}` sourceEntrypoint=`{entrypoint}` sourceStartupMode=`{startup}`".format(
                    artifact=item.get("sourceArtifact", "n/a"),
                    kind=item.get("sourceArtifactKind", "n/a"),
                    phase=item.get("sourcePhase", "n/a"),
                    completion=item.get("completionStatus", "n/a"),
                    proof=item.get("sourceProofStatus", "n/a"),
                    bom=format_markdown_list(item.get("sourceBom")),
                    spec=format_markdown_list(item.get("sourceSpec")),
                    gate=item.get("sourceGate", "n/a"),
                    cell=item.get("sourceCellId", "n/a"),
                    entrypoint=item.get("sourceEntrypoint", "n/a"),
                    startup=item.get("sourceStartupMode", "n/a"),
                )
            details_text = ""
            if item.get("evidenceDetails"):
                details_text = " details=`{details}`".format(
                    details=format_markdown_list(item.get("evidenceDetails")),
                )
            issue_text = ""
            if item.get("issueBreakdown"):
                issue_text = " issues=`{issues}`".format(
                    issues=format_markdown_list(
                        [
                            issue.get("category", "unknown")
                            for issue in item.get("issueBreakdown", [])
                            if isinstance(issue, dict)
                        ]
                    ),
                )
            env_text = ""
            if item.get("environmentClassification"):
                env_text = " envClass=`{env_class}`".format(
                    env_class=item.get("environmentClassification"),
                )
            review_text = ""
            if item.get("recommendedReviewCommands"):
                review_text = " reviewCommands=`{commands}`".format(
                    commands=format_markdown_list(
                        [
                            command.get("command", "")
                            for command in item.get("recommendedReviewCommands", [])
                            if isinstance(command, dict) and command.get("command")
                        ]
                    ),
                )
            lines.append(
                "- `{scope}` status=`{status}` proof=`{proof}` sampleEmissionAllowed=`{sample_allowed}` evidenceStatus=`{evidence_status}` evidence=`{evidence}`{source}{details}{issues}{env}{review_commands} reason={reason}".format(
                    scope=item.get("scope"),
                    status=item.get("status"),
                    proof=item.get("proofStatus", "UNPROVEN"),
                    sample_allowed=item.get("sampleEmissionAllowed", "n/a"),
                    evidence_status=item.get("evidenceStatus", "n/a"),
                    evidence=item.get("evidencePath", "n/a"),
                    source=source_text,
                    details=details_text,
                    issues=issue_text,
                    env=env_text,
                    review_commands=review_text,
                    reason=item.get("reason"),
                )
            )
            local_source = item.get("localSourceRouteEvidence")
            if isinstance(local_source, dict):
                lines.append("  - localSourceRouteEvidence=`{value}`".format(value=json.dumps(local_source, sort_keys=True, ensure_ascii=False)))
            local_deployment = item.get("localSourceDeploymentEvidence")
            if isinstance(local_deployment, dict):
                lines.append("  - localSourceDeploymentEvidence=`{value}`".format(value=json.dumps(local_deployment, sort_keys=True, ensure_ascii=False)))
            target_runtime = item.get("targetRuntimeRouteEvidence")
            if isinstance(target_runtime, dict):
                lines.append("  - targetRuntimeRouteEvidence=`{value}`".format(value=json.dumps(compact_target_runtime_route_evidence(target_runtime), sort_keys=True, ensure_ascii=False)))
            runtime_closure = item.get("runtimeClosureEvidence")
            if isinstance(runtime_closure, dict):
                lines.append("  - runtimeClosureEvidence=`{value}`".format(value=json.dumps(runtime_closure, sort_keys=True, ensure_ascii=False)))
            sample_blockers = item.get("sampleBlockers")
            if isinstance(sample_blockers, list) and sample_blockers:
                lines.append("  - sampleBlockers=`{value}`".format(value=json.dumps(sample_blockers, sort_keys=True, ensure_ascii=False)))
            route_trust_proofs = item.get("routeTrustBlockedProofs")
            if isinstance(route_trust_proofs, list) and route_trust_proofs:
                lines.append("  - routeTrustBlockedProofs=`{value}`".format(value=json.dumps(route_trust_proofs, sort_keys=True, ensure_ascii=False)))
            downstream_proofs = item.get("blockedDownstreamProofs")
            if isinstance(downstream_proofs, list) and downstream_proofs:
                lines.append("  - blockedDownstreamProofs=`{value}`".format(value=json.dumps(downstream_proofs, sort_keys=True, ensure_ascii=False)))
    else:
        lines.append("- none")
    lines.extend(["", "## Issue Breakdown", ""])
    issue_breakdown = report.get("issueBreakdown", report.get("issue_breakdown", []))
    if issue_breakdown:
        for issue in issue_breakdown:
            if not isinstance(issue, dict):
                continue
            details_text = ""
            if issue.get("evidenceDetails"):
                details_text = " details=`{details}`".format(
                    details=format_markdown_list(issue.get("evidenceDetails")),
                )
            review_text = ""
            review_commands = issue.get("recommendedReviewCommands", issue.get("recommended_review_commands"))
            if review_commands:
                review_text = " reviewCommands=`{commands}`".format(
                    commands=format_markdown_list(
                        [
                            command.get("command", "")
                            for command in review_commands
                            if isinstance(command, dict) and command.get("command")
                        ]
                    ),
                )
            env_text = ""
            if issue.get("environmentClassification"):
                env_text = " envClass=`{env_class}`".format(
                    env_class=issue.get("environmentClassification"),
                )
            lines.append(
                "- `{category}` failedStep=`{failed_step}` sourceArtifact=`{artifact}` sourceKind=`{kind}` sourcePhase=`{phase}` sourceBom=`{bom}` sourceSpec=`{spec}` sourceGate=`{gate}`{env}{details}{review_commands} summary={summary} proofImpact={impact}".format(
                    category=issue.get("category", "unknown"),
                    failed_step=issue.get("failedStep", "unknown"),
                    artifact=issue.get("sourceArtifact", "n/a"),
                    kind=issue.get("sourceArtifactKind", "n/a"),
                    phase=issue.get("sourcePhase", "n/a"),
                    bom=format_markdown_list(issue.get("sourceBom")),
                    spec=format_markdown_list(issue.get("sourceSpec")),
                    gate=issue.get("sourceGate", "n/a"),
                    env=env_text,
                    details=details_text,
                    review_commands=review_text,
                    summary=issue.get("summary", "n/a"),
                    impact=issue.get("proofImpact", "n/a"),
                )
            )
            local_source = issue.get("localSourceRouteEvidence")
            if isinstance(local_source, dict):
                lines.append("  - localSourceRouteEvidence=`{value}`".format(value=json.dumps(local_source, sort_keys=True, ensure_ascii=False)))
            local_deployment = issue.get("localSourceDeploymentEvidence")
            if isinstance(local_deployment, dict):
                lines.append("  - localSourceDeploymentEvidence=`{value}`".format(value=json.dumps(local_deployment, sort_keys=True, ensure_ascii=False)))
            target_runtime = issue.get("targetRuntimeRouteEvidence")
            if isinstance(target_runtime, dict):
                lines.append("  - targetRuntimeRouteEvidence=`{value}`".format(value=json.dumps(compact_target_runtime_route_evidence(target_runtime), sort_keys=True, ensure_ascii=False)))
            runtime_closure = issue.get("runtimeClosureEvidence")
            if isinstance(runtime_closure, dict):
                lines.append("  - runtimeClosureEvidence=`{value}`".format(value=json.dumps(runtime_closure, sort_keys=True, ensure_ascii=False)))
            sample_blockers = issue.get("sampleBlockers")
            if isinstance(sample_blockers, list) and sample_blockers:
                lines.append("  - sampleBlockers=`{value}`".format(value=json.dumps(sample_blockers, sort_keys=True, ensure_ascii=False)))
    else:
        lines.append("- none")
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- This file is a Dev/CI report assembled from Station mirror and matrix gate artifacts.",
            "- Station remains the product telemetry sink.",
            "- Missing Station mirror, anchor inventory, anchor DOM evidence, matrix, or red-line proof keeps this report PARTIAL/UNPROVEN.",
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
        "--station-mirror-report",
    )
    parser.add_argument(
        "--matrix-report",
    )
    parser.add_argument(
        "--preflight-report",
    )
    parser.add_argument(
        "--anchor-inventory-report",
    )
    parser.add_argument(
        "--anchor-dom-evidence-gate-report",
    )
    parser.add_argument(
        "--anchor-source-gate-report",
    )
    parser.add_argument(
        "--sampler-gate-report",
    )
    parser.add_argument(
        "--output-prefix",
    )
    args = parser.parse_args()
    defaults = {
        "station_mirror_report": ("desktop-telemetry-live-gate", "mirror-report"),
        "matrix_report": ("desktop-performance-matrix-gate", "report"),
        "preflight_report": ("desktop-performance-preflight-gate", "report"),
        "anchor_inventory_report": ("desktop-anchor-inventory-gate", "report"),
        "anchor_dom_evidence_gate_report": (
            "desktop-anchor-dom-evidence-gate",
            "report",
        ),
        "anchor_source_gate_report": ("desktop-anchor-source-gate", "report"),
        "sampler_gate_report": ("desktop-performance-sampler-gate", "report"),
    }
    input_refs: dict[str, Any] = {}
    for attribute, (gate_id, role) in defaults.items():
        if getattr(args, attribute) is None:
            setattr(args, attribute, str(latest_path(gate_id, role)))
            input_refs[attribute] = latest_ref(gate_id, role)
    report = build_report(args)
    if input_refs:
        report["inputArtifactRefs"] = input_refs
    if args.output_prefix:
        json_path, md_path = write_outputs(report, args.output_prefix)
        display_json = str(json_path)
        display_markdown = str(md_path)
    else:
        with artifact_session(PRODUCER_GATE_ID) as session:
            session.write_json(DEFAULT_OUTPUT_PREFIX + ".json", report, role="report")
            session.write_bytes(
                DEFAULT_OUTPUT_PREFIX + ".md",
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role="report-markdown",
            )
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_json = DEFAULT_OUTPUT_PREFIX + ".json"
        display_markdown = DEFAULT_OUTPUT_PREFIX + ".md"
    print(f"desktop performance report: {display_json}")
    print(f"desktop performance report: {display_markdown}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
