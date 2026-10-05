#!/usr/bin/env python3
"""Validate P0b sampler evidence from the Desktop Station mirror."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import (
    artifact_session,
    explicit_output_path,
    inspect_command,
    latest_artifact,
    replace_resolved_artifact_paths,
)


PRODUCER_GATE_ID = "desktop-performance-sampler-gate"
DEFAULT_OUTPUT_PREFIX = "reports/desktop-performance-sampler-gate-latest"
STATION_MIRROR_OUTPUT_PREFIX = "tooling/acceptance/reports/desktop-performance-station-mirror"
STATION_MIRROR_REPORT_PATH = f"{STATION_MIRROR_OUTPUT_PREFIX}.json"

PHASE = "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5"
BOM = [
    "BOM-CON-02",
    "BOM-CAP-03",
    "BOM-SMP-02",
    "BOM-SMP-03",
    "BOM-SMP-04",
    "BOM-SMP-05",
    "BOM-SMP-06",
    "BOM-RUN-05",
    "BOM-CAP-05",
]
SPEC = [
    "SPEC-INT-01",
    "SPEC-SMP-REACT-01",
    "SPEC-SMP-STORE-01",
    "SPEC-SMP-OVERLAY-01",
    "SPEC-SMP-INVOKE-01",
    "SPEC-SMP-MAIN-01",
    "SPEC-MIRROR-01",
    "SPEC-STA-03",
]
GATE = (
    "Station mirror sampler evidence must prove interaction correlation, React commit, "
    "store update, overlay latency, invoke, and main-thread event families before P0b proof is allowed"
)
RUNTIME_CLOSURE_ARTIFACT_KIND = "desktop-telemetry-runtime-closure-gate"
RUNTIME_CLOSURE_PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
RUNTIME_CLOSURE_BOM = ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"]
RUNTIME_CLOSURE_SPEC = [
    "SPEC-GW-01",
    "SPEC-STA-01",
    "SPEC-STA-02",
    "SPEC-DB-01",
    "SPEC-DB-02",
    "SPEC-STA-03",
    "SPEC-MIRROR-01",
]
RUNTIME_CLOSURE_GATE = (
    "P0a Station runtime proof must use a managed Station+Postgres dependency closure before "
    "Gateway upload, route probe, query, rollup, mirror, sampler collection, or runtime sample emission can be trusted"
)
LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND = "desktop-local-telemetry-buffer-gate"
LOCAL_TELEMETRY_BUFFER_PHASE = PHASE
LOCAL_TELEMETRY_BUFFER_BOM = BOM
LOCAL_TELEMETRY_BUFFER_SPEC = SPEC
LOCAL_TELEMETRY_BUFFER_GATE = (
    "Local Desktop telemetry buffer diagnostics must prove sampler event families and interactionId presence "
    "without replacing Station mirror evidence"
)
LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_ARTIFACT_KIND = "desktop-local-telemetry-buffer-observations-template"
LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_JSON = (
    "reports/desktop-local-telemetry-buffer-observations-template.json"
)
LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_MD = (
    "reports/desktop-local-telemetry-buffer-observations-template.md"
)
LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_PATH = (
    "<explicit-desktop-local-telemetry-buffer-observations.json>"
)
LOCAL_TELEMETRY_BUFFER_REQUIRED_OBSERVATION_FIELDS = [
    "source",
    "runtime",
    "url",
    "readyState",
    "eventCount",
    "maxEvents",
    "droppedCount",
    "byKind",
    "withInteraction",
    "droppedByKind",
    "droppedWithInteraction",
]
LOCAL_TELEMETRY_BUFFER_REQUIRED_FAMILIES = {
    "interaction": ["interaction.started"],
    "reactCommit": ["react.commit"],
    "storeUpdate": ["store.update"],
    "overlayLatency": ["contextmenu.intent", "overlay.visible"],
    "invoke": ["invoke.started", "invoke.completed", "invoke.failed"],
    "mainThread": ["longtask.detected", "layout.shift", "paint.timing"],
}


def issue_from_blocked_reason(item: dict[str, Any], review_commands: list[dict[str, str]]) -> dict[str, Any]:
    scope = str(item.get("scope") or "unknown")
    if scope == "station-mirror-source":
        category = "station-mirror-source"
    elif scope == "runtime-closure":
        category = "runtime-closure-unproven"
    elif scope == "local-telemetry-buffer":
        category = "local-telemetry-buffer-unproven"
    elif scope.startswith("dom-anchor:"):
        category = "dom-anchor-blocker"
    else:
        category = "sampler-evidence"
    issue: dict[str, Any] = {
        "category": category,
        "failedStep": scope,
        "status": str(item.get("status") or "diagnostic incomplete"),
        "completionStatus": str(item.get("completionStatus") or "PARTIAL"),
        "proofStatus": str(item.get("proofStatus") or item.get("sourceProofStatus") or "UNPROVEN"),
        "sampleEmissionAllowed": False,
        "summary": str(item.get("reason") or "Sampler evidence is not proven."),
        "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN and sample emission stays disabled.",
    }
    for source_key in (
        "sourceArtifact",
        "sourceArtifactKind",
        "sourcePhase",
        "sourceBom",
        "sourceSpec",
        "sourceGate",
    ):
        if source_key in item:
            issue[source_key] = item[source_key]
    evidence_details = item.get("evidenceDetails")
    if isinstance(evidence_details, list):
        issue["details"] = evidence_details
        issue["evidenceDetails"] = evidence_details
    issue_review_commands = item.get("recommended_review_commands", item.get("recommendedReviewCommands"))
    if not isinstance(issue_review_commands, list):
        issue_review_commands = review_commands
    if issue_review_commands:
        issue["recommended_review_commands"] = issue_review_commands
        issue["recommendedReviewCommands"] = issue_review_commands
    return issue


def normalize_blocked_reasons(blocked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in blocked:
        reason = dict(item)
        reason["sampleEmissionAllowed"] = False
        reason.setdefault("completionStatus", "PARTIAL")
        reason.setdefault("proofStatus", reason.get("sourceProofStatus") or "UNPROVEN")
        normalized.append(reason)
    return normalized


def recommended_review_commands(station_mirror_report: Path) -> list[dict[str, str]]:
    return [
        {
            "purpose": "Prove managed Station+Postgres runtime closure before trusting sampler evidence.",
            "command": "python3 tooling/scripts/desktop-telemetry-runtime-closure-gate.py",
        },
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Start Station through the project entrypoint if local Station is required.",
            "command": "make station",
        },
        {
            "purpose": "Query Station telemetry into an explicit Dev/CI mirror.",
            "command": (
                "python3 tooling/scripts/desktop-telemetry-mirror.py "
                f"--output-prefix {STATION_MIRROR_OUTPUT_PREFIX}"
            ),
        },
        {
            "purpose": "Inspect the sampler gate diagnostic artifact.",
            "command": inspect_command(PRODUCER_GATE_ID, "report"),
        },
        {
            "purpose": "Re-run only the sampler gate after Station mirror evidence exists.",
            "command": (
                "python3 tooling/scripts/desktop-performance-sampler-gate.py "
                f"--station-mirror-report {STATION_MIRROR_REPORT_PATH}"
            ),
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def sampler_gate_reason(blocked: list[dict[str, Any]]) -> str:
    if not blocked:
        return "Sampler evidence is proven"
    station_reasons = [
        str(item.get("reason"))
        for item in blocked
        if item.get("scope") == "station-mirror-source" and item.get("reason")
    ]
    sampler_ids = [
        str(item.get("scope")).removeprefix("sampler:")
        for item in blocked
        if str(item.get("scope", "")).startswith("sampler:")
    ]
    parts: list[str] = []
    if station_reasons:
        parts.append(station_reasons[0])
    if sampler_ids:
        parts.append(f"{len(sampler_ids)} sampler families are not proven: {', '.join(sampler_ids)}")
    dom_blockers = [
        str(item.get("blockedByStep") or item.get("scope"))
        for item in blocked
        if str(item.get("scope", "")).startswith("dom-anchor:")
    ]
    if dom_blockers:
        parts.append(f"DOM anchor blockers prevent sampler collection: {', '.join(dom_blockers)}")
    runtime_closure_reasons = [
        str(item.get("reason"))
        for item in blocked
        if item.get("scope") == "runtime-closure" and item.get("reason")
    ]
    if runtime_closure_reasons:
        parts.append(runtime_closure_reasons[0])
    return "; ".join(parts) if parts else "Sampler evidence is not proven"


def sampler_gate_summary(
    *,
    station_source: dict[str, Any],
    samplers: list[dict[str, Any]],
    blocked: list[dict[str, Any]],
    sample_emission_allowed: bool,
    dom_anchor_gate: dict[str, Any] | None = None,
    runtime_closure: dict[str, Any] | None = None,
      local_telemetry_buffer: dict[str, Any] | None = None,
) -> dict[str, Any]:
    proven_samplers = [
        sampler["samplerId"]
        for sampler in samplers
        if sampler["status"] == "loaded" and sampler["proofStatus"] == "PROVEN"
    ]
    unproven_samplers = [
        sampler["samplerId"]
        for sampler in samplers
        if sampler["status"] != "loaded" or sampler["proofStatus"] != "PROVEN"
    ]
    station_summary = station_source.get("summary")
    if not isinstance(station_summary, dict):
        station_summary = {}
    if not isinstance(dom_anchor_gate, dict):
        dom_anchor_gate = {}
    if not isinstance(runtime_closure, dict):
        runtime_closure = {}
    if not isinstance(local_telemetry_buffer, dict):
        local_telemetry_buffer = {}
    dom_summary = dom_anchor_gate.get("summary")
    if not isinstance(dom_summary, dict):
        dom_summary = {}
    return {
        "stationMirrorStatus": station_source.get("status"),
        "stationMirrorProofStatus": station_source.get("proofStatus"),
        "stationMirrorReason": station_source.get("reason"),
        "stationMirrorEventCount": station_summary.get("eventCount"),
        "stationMirrorRollupCount": station_summary.get("rollupCount"),
        "sampleEmissionAllowed": sample_emission_allowed,
        "samplerFamilyCount": len(samplers),
        "provenSamplerCount": len(proven_samplers),
        "unprovenSamplerCount": len(unproven_samplers),
        "provenSamplers": proven_samplers,
        "unprovenSamplers": unproven_samplers,
        "blockedScopeCount": len(blocked),
        "blockedScopes": [str(item.get("scope")) for item in blocked],
        "domAnchorGateStatus": dom_anchor_gate.get("status"),
        "domAnchorGateProofStatus": dom_anchor_gate.get("proofStatus"),
        "domAnchorBlockedBySteps": dom_summary.get("blockedBySteps") or [],
          "domAnchorBlockedDownstreamSteps": dom_summary.get("blockedDownstreamSteps") or [],
          "localTelemetryBufferStatus": local_telemetry_buffer.get("status"),
          "localTelemetryBufferProofStatus": local_telemetry_buffer.get("proofStatus"),
          "localTelemetryBufferCompletionStatus": local_telemetry_buffer.get("completionStatus"),
          "localTelemetryBufferSampleEmissionAllowed": local_telemetry_buffer.get("sampleEmissionAllowed"),
          "localTelemetryBufferEventCount": local_telemetry_buffer.get("eventCount"),
          "localTelemetryBufferDroppedCount": local_telemetry_buffer.get("droppedCount"),
          "localTelemetryBufferObservationSourceStatus": local_telemetry_buffer.get("observationSourceStatus"),
          "localTelemetryBufferObservationConsistencyStatus": local_telemetry_buffer.get("observationConsistencyStatus"),
          "localTelemetryBufferRequiredObservationFields": local_telemetry_buffer.get("requiredObservationFields") or [],
          "localTelemetryBufferPresentObservationFields": local_telemetry_buffer.get("presentObservationFields") or [],
          "localTelemetryBufferMissingObservationFields": local_telemetry_buffer.get("missingObservationFields") or [],
          "localTelemetryBufferObservationTemplateJsonPath": local_telemetry_buffer.get("observationTemplateJsonPath"),
          "localTelemetryBufferObservationTemplateMarkdownPath": local_telemetry_buffer.get(
              "observationTemplateMarkdownPath"
          ),
          "localTelemetryBufferRetentionWindowStatus": local_telemetry_buffer.get("retentionWindowStatus"),
          "localTelemetryBufferRetentionWindowProofStatus": local_telemetry_buffer.get("retentionWindowProofStatus"),
          "localTelemetryBufferRetentionWindowMaxEvents": local_telemetry_buffer.get("retentionWindowMaxEvents"),
          "localTelemetryBufferRetentionWindowCapacityProven": local_telemetry_buffer.get(
              "retentionWindowCapacityProven"
          ),
          "localTelemetryBufferRetentionWindowDroppedByKindCountSum": local_telemetry_buffer.get(
              "retentionWindowDroppedByKindCountSum"
          ),
          "localTelemetryBufferRetentionWindowDroppedWithInteractionCountSum": local_telemetry_buffer.get(
              "retentionWindowDroppedWithInteractionCountSum"
          ),
          "localTelemetryBufferRetentionWindowDroppedKindAttributionProven": local_telemetry_buffer.get(
              "retentionWindowDroppedKindAttributionProven"
          ),
            "localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid": local_telemetry_buffer.get(
                "retentionWindowDroppedInteractionAttributionValid"
            ),
          "localTelemetryBufferRetentionWindowTotalObservedOrDroppedCount": local_telemetry_buffer.get(
              "retentionWindowTotalObservedOrDroppedCount"
          ),
          "localTelemetryBufferRetentionWindowDropRatio": local_telemetry_buffer.get("retentionWindowDropRatio"),
          "localTelemetryBufferRetentionWindowRetainedRatio": local_telemetry_buffer.get("retentionWindowRetainedRatio"),
          "localTelemetryBufferRetentionWindowTailWindowOnly": local_telemetry_buffer.get(
              "retentionWindowTailWindowOnly"
          ),
          "localTelemetryBufferRetentionWindowReason": local_telemetry_buffer.get("retentionWindowReason"),
          "localTelemetryBufferDroppedByKind": local_telemetry_buffer.get("droppedByKind") or {},
          "localTelemetryBufferDroppedWithInteraction": local_telemetry_buffer.get("droppedWithInteraction") or {},
          "localTelemetryBufferFamilyPassCount": local_telemetry_buffer.get("familyPassCount"),
          "localTelemetryBufferFamilyUnprovenCount": local_telemetry_buffer.get("familyUnprovenCount"),
        "runtimeClosureStatus": runtime_closure.get("status"),
        "runtimeClosureProofStatus": runtime_closure.get("proofStatus"),
        "runtimeClosureSampleEmissionAllowed": runtime_closure.get("sampleEmissionAllowed"),
        "runtimeClosureManagedRuntime": runtime_closure.get("managedRuntimeClosure"),
        "runtimeClosureLocalProofStatus": runtime_closure.get("localRuntimeClosureProofStatus"),
        "runtimeClosureComposeProofStatus": runtime_closure.get("composeRuntimeClosureProofStatus"),
        "runtimeClosureDockerDaemonProofStatus": runtime_closure.get("dockerDaemonProofStatus"),
        "runtimeClosureFailedCheckCount": runtime_closure.get("failedCheckCount"),
          "runtimeClosureCheckReasons": runtime_closure.get("checkReasons") or {},
          "runtimeClosureFailedCheckReasons": runtime_closure.get("failedCheckReasons") or {},
          "runtimeClosureLocalRuntimeClosure": runtime_closure.get("localRuntimeClosure") or {},
          "runtimeClosureComposeRuntimeClosure": runtime_closure.get("composeRuntimeClosure") or {},
    }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


ANALYSIS_AGGREGATION_TRACE = {
    "reactCommitAggregation": {
        "phase": "P0b-3/P0c-5",
        "bom": ["BOM-SMP-02", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-REACT-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "React commit sampler evidence must be present in Station mirror before report proof is allowed",
    },
    "storeUpdateAggregation": {
        "phase": "P0b-4/P0c-5",
        "bom": ["BOM-SMP-03", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-STORE-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Store update sampler evidence must be present in Station mirror before report proof is allowed",
    },
    "overlayLatencyAggregation": {
        "phase": "P0b-5/P0c-5",
        "bom": ["BOM-SMP-04", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-OVERLAY-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Overlay intent/visible latency evidence must be present in Station mirror before report proof is allowed",
    },
    "invokeAggregation": {
        "phase": "P0b-6/P0c-5",
        "bom": ["BOM-SMP-05", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-INVOKE-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Invoke started/completed/failed evidence must be present in Station mirror before report proof is allowed",
    },
    "mainThreadExceptions": {
        "phase": "P0b-7/P0c-5",
        "bom": ["BOM-SMP-06", "BOM-RUN-05", "BOM-CAP-05"],
        "spec": ["SPEC-SMP-MAIN-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
        "gate": "Main-thread longtask/layout/paint evidence must either be within budget or carry an explicit exception",
    },
}
ANALYSIS_INTERACTION_EVENT_KINDS = {
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
ANALYSIS_MAIN_THREAD_EVENT_KINDS = {
    "longtask.detected",
    "layout.shift",
    "paint.timing",
}
ANALYSIS_MIRROR_KIND = "desktop-performance-station-mirror"
ANALYSIS_MIRROR_PHASE = "P0a-6/P0c-5"
ANALYSIS_MIRROR_BOM = ("BOM-CAP-05", "BOM-RUN-05")
ANALYSIS_MIRROR_SPEC = ("SPEC-STA-03", "SPEC-MIRROR-01")


def analysis_read_json_if_present(
    path: Path,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    if not path.exists():
        return None, {"path": str(path), "status": "missing"}
    return json.loads(path.read_text(encoding="utf-8")), {
        "path": str(path),
        "status": "loaded",
    }


def analysis_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Native Desktop development runtime.",
            "command": "make desktop",
        },
        {
            "purpose": "Query Station telemetry into an explicit Dev/CI mirror.",
            "command": (
                "python3 tooling/scripts/desktop-telemetry-mirror.py "
                f"--output-prefix {STATION_MIRROR_OUTPUT_PREFIX}"
            ),
        },
        {
            "purpose": "Re-run the Native sampler gate.",
            "command": (
                "python3 tooling/scripts/desktop-performance-sampler-gate.py "
                f"--station-mirror-report {STATION_MIRROR_REPORT_PATH}"
            ),
        },
    ]


def analysis_station_mirror_source_state(
    station_report: dict[str, Any] | None,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    if station_report is None:
        reason = f"missing Station mirror report: {evidence['path']}"
        return {
            "status": "missing",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "reason": reason,
            "evidencePath": evidence["path"],
            "evidenceStatus": evidence["status"],
            "details": [],
            "recommended_review_commands": analysis_review_commands(),
            "recommendedReviewCommands": analysis_review_commands(),
        }

    details: list[str] = []
    if station_report.get("artifactKind") != ANALYSIS_MIRROR_KIND:
        details.append("missing or invalid artifactKind")
    if station_report.get("phase") != ANALYSIS_MIRROR_PHASE:
        details.append("missing or invalid phase")
    if not all(
        item in station_report.get("bom", [])
        for item in ANALYSIS_MIRROR_BOM
    ):
        details.append("missing required mirror BOM binding")
    if not all(
        item in station_report.get("spec", [])
        for item in ANALYSIS_MIRROR_SPEC
    ):
        details.append("missing required mirror Spec binding")
    if station_report.get("completionStatus") != "DONE":
        details.append("missing or invalid completionStatus")
    if station_report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    if station_report.get("productSink") != "Station":
        details.append("missing Station product sink boundary")
    if station_report.get("mirrorRole") != "Dev/CI evidence artifact":
        details.append("missing Dev/CI mirror role boundary")

    issues = station_report.get(
        "issue_breakdown",
        station_report.get("issueBreakdown"),
    )
    issue_details: list[Any] = []
    if isinstance(issues, list):
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            candidate = issue.get("evidenceDetails", issue.get("details"))
            if isinstance(candidate, list):
                issue_details.extend(candidate)
    status = "loaded" if not details else "diagnostic incomplete"
    reason = (
        "Station mirror source metadata is valid"
        if status == "loaded"
        else str(
            station_report.get("reason")
            or "Station mirror source metadata is incomplete"
        )
    )
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
        "details": issue_details or details,
        "summary": station_report.get("summary", {}),
    }
    if status != "loaded":
        commands = station_report.get(
            "recommended_review_commands",
            station_report.get("recommendedReviewCommands"),
        )
        if not isinstance(commands, list):
            commands = analysis_review_commands()
        if isinstance(issues, list):
            state["issue_breakdown"] = issues
            state["issueBreakdown"] = issues
        state["recommended_review_commands"] = commands
        state["recommendedReviewCommands"] = commands
    return state


def analysis_events(
    station_report: dict[str, Any] | None,
    kinds: set[str],
) -> list[dict[str, Any]]:
    if not isinstance(station_report, dict):
        return []
    events = station_report.get("events")
    if not isinstance(events, list):
        return []
    return [
        event
        for event in events
        if isinstance(event, dict) and event.get("kind") in kinds
    ]


def analysis_simple_event_family(
    station_report: dict[str, Any] | None,
    *,
    kinds: set[str],
    count_key: str,
    missing_reason: str,
) -> dict[str, Any]:
    events = analysis_events(station_report, kinds)
    if not events:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": missing_reason,
            count_key: 0,
        }
    durations = [
        float(event["durationMs"])
        for event in events
        if isinstance(event.get("durationMs"), (int, float))
    ]
    return {
        "status": "loaded",
        "proofStatus": "PROVEN",
        "reason": f"{','.join(sorted(kinds))} events are present",
        count_key: len(events),
        "maxDurationMs": max(durations) if durations else None,
    }


def analysis_interaction_correlation_summary(
    station_report: dict[str, Any] | None,
) -> dict[str, Any]:
    events = analysis_events(
        station_report,
        ANALYSIS_INTERACTION_EVENT_KINDS,
    )
    if not events:
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no interaction-correlated event families in Station mirror",
            "trackedEventCount": 0,
            "linkedEventCount": 0,
            "unlinkedEventCount": 0,
        }
    unlinked = [event for event in events if not event.get("interactionId")]
    return {
        "status": "loaded" if not unlinked else "diagnostic incomplete",
        "proofStatus": "PROVEN" if not unlinked else "UNPROVEN",
        "reason": (
            "interaction-correlated event families carry interactionId"
            if not unlinked
            else "interaction-correlated events are missing interactionId"
        ),
        "trackedEventCount": len(events),
        "linkedEventCount": len(events) - len(unlinked),
        "unlinkedEventCount": len(unlinked),
    }


def analysis_react_commit_aggregation(
    station_report: dict[str, Any] | None,
) -> dict[str, Any]:
    return analysis_simple_event_family(
        station_report,
        kinds={"react.commit"},
        count_key="commitCount",
        missing_reason="no react.commit events in Station mirror",
    )


def analysis_store_update_aggregation(
    station_report: dict[str, Any] | None,
) -> dict[str, Any]:
    return analysis_simple_event_family(
        station_report,
        kinds={"store.update"},
        count_key="updateCount",
        missing_reason="no store.update events in Station mirror",
    )


def analysis_overlay_latency_aggregation(
    station_report: dict[str, Any] | None,
) -> dict[str, Any]:
    intents = analysis_events(station_report, {"contextmenu.intent"})
    visible = analysis_events(station_report, {"overlay.visible"})
    paired = min(len(intents), len(visible))
    missing = max(0, len(intents) - len(visible))
    status = "loaded" if intents and visible and missing == 0 else "diagnostic incomplete"
    return {
        "status": status,
        "proofStatus": "PROVEN" if status == "loaded" else "UNPROVEN",
        "reason": (
            "contextmenu.intent and overlay.visible events are paired"
            if status == "loaded"
            else "overlay telemetry is incomplete"
        ),
        "intentCount": len(intents),
        "visibleCount": len(visible),
        "pairedVisibleCount": paired,
        "missingVisibleCount": missing,
    }


def analysis_invoke_aggregation(
    station_report: dict[str, Any] | None,
) -> dict[str, Any]:
    events = analysis_events(
        station_report,
        {"invoke.started", "invoke.completed", "invoke.failed"},
    )
    terminal = [
        event
        for event in events
        if event.get("kind") in {"invoke.completed", "invoke.failed"}
    ]
    status = "loaded" if events and terminal else "diagnostic incomplete"
    return {
        "status": status,
        "proofStatus": "PROVEN" if status == "loaded" else "UNPROVEN",
        "reason": (
            "invoke events include a terminal observation"
            if status == "loaded"
            else "invoke telemetry has no completed/failed terminal events"
        ),
        "eventCount": len(events),
        "terminalCount": len(terminal),
        "failedCount": sum(
            1 for event in terminal if event.get("kind") == "invoke.failed"
        ),
    }


def analysis_main_thread_exception_summary(
    station_report: dict[str, Any] | None,
) -> dict[str, Any]:
    events = analysis_events(
        station_report,
        ANALYSIS_MAIN_THREAD_EVENT_KINDS,
    )
    violations = []
    for event in events:
        duration = event.get("durationMs")
        data = event.get("data")
        threshold = data.get("thresholdMs") if isinstance(data, dict) else None
        if (
            isinstance(duration, (int, float))
            and isinstance(threshold, (int, float))
            and duration > threshold
            and not (isinstance(data, dict) and isinstance(data.get("exception"), dict))
        ):
            violations.append(event)
    status = "loaded" if events and not violations else "diagnostic incomplete"
    return {
        "status": status,
        "proofStatus": "PROVEN" if status == "loaded" else "UNPROVEN",
        "reason": (
            "main-thread events are within budget or excepted"
            if status == "loaded"
            else "main-thread evidence is missing or over budget"
        ),
        "eventCount": len(events),
        "violationCount": len(violations),
        "exceptionCount": 0,
    }


class NativeSamplerAnalysis:
    AGGREGATION_TRACE = ANALYSIS_AGGREGATION_TRACE
    INTERACTION_CORRELATION_EVENT_KINDS = ANALYSIS_INTERACTION_EVENT_KINDS
    MAIN_THREAD_EVENT_KINDS = ANALYSIS_MAIN_THREAD_EVENT_KINDS
    MIRROR_REQUIRED_ARTIFACT_KIND = ANALYSIS_MIRROR_KIND
    MIRROR_REQUIRED_PHASE = ANALYSIS_MIRROR_PHASE
    MIRROR_REQUIRED_BOM = ANALYSIS_MIRROR_BOM
    MIRROR_REQUIRED_SPEC = ANALYSIS_MIRROR_SPEC

    read_json_if_present = staticmethod(analysis_read_json_if_present)
    station_mirror_source_state = staticmethod(
        analysis_station_mirror_source_state
    )
    interaction_correlation_summary = staticmethod(
        analysis_interaction_correlation_summary
    )
    react_commit_aggregation = staticmethod(
        analysis_react_commit_aggregation
    )
    store_update_aggregation = staticmethod(
        analysis_store_update_aggregation
    )
    overlay_latency_aggregation = staticmethod(
        analysis_overlay_latency_aggregation
    )
    invoke_aggregation = staticmethod(analysis_invoke_aggregation)
    main_thread_exception_summary = staticmethod(
        analysis_main_thread_exception_summary
    )


def load_report_module() -> type[NativeSamplerAnalysis]:
    return NativeSamplerAnalysis


def read_runtime_closure_evidence(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {
            "path": None,
            "status": "pass",
            "proofStatus": "PROVEN",
            "sampleEmissionAllowed": True,
            "reason": "runtime closure check disabled for this sampler invocation",
        }
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "sourceArtifactKind": RUNTIME_CLOSURE_ARTIFACT_KIND,
            "sourcePhase": RUNTIME_CLOSURE_PHASE,
            "sourceBom": RUNTIME_CLOSURE_BOM,
            "sourceSpec": RUNTIME_CLOSURE_SPEC,
            "sourceGate": RUNTIME_CLOSURE_GATE,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "managedRuntimeClosure": None,
            "reason": f"runtime closure artifact is missing: {exc}",
            "details": ["runtime closure artifact is missing"],
        }
    except json.JSONDecodeError as exc:
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "sourceArtifactKind": RUNTIME_CLOSURE_ARTIFACT_KIND,
            "sourcePhase": RUNTIME_CLOSURE_PHASE,
            "sourceBom": RUNTIME_CLOSURE_BOM,
            "sourceSpec": RUNTIME_CLOSURE_SPEC,
            "sourceGate": RUNTIME_CLOSURE_GATE,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "managedRuntimeClosure": None,
            "reason": f"runtime closure artifact is invalid JSON: {exc}",
            "details": ["runtime closure artifact is invalid JSON"],
        }
    details: list[str] = []
    if report.get("artifactKind") != RUNTIME_CLOSURE_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if report.get("phase") != RUNTIME_CLOSURE_PHASE:
        details.append("missing or invalid phase")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in RUNTIME_CLOSURE_BOM):
        details.append("missing required runtime-closure BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in RUNTIME_CLOSURE_SPEC):
        details.append("missing required runtime-closure Spec binding")
    if report.get("completionStatus") != "DONE":
        details.append("runtime closure completionStatus is not DONE")
    if report.get("proofStatus") != "PROVEN":
        details.append("runtime closure proofStatus is not PROVEN")
    if report.get("sampleEmissionAllowed") is not True:
        details.append("runtime closure sampleEmissionAllowed is not true")
    summary = report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    return {
        "path": str(path),
        "sourceArtifact": str(path),
        "sourceArtifactKind": report.get("artifactKind"),
        "sourcePhase": report.get("phase"),
        "sourceBom": report.get("bom", []),
        "sourceSpec": report.get("spec", []),
        "sourceGate": report.get("gate"),
        "status": "pass" if not details else "diagnostic incomplete",
        "completionStatus": "DONE" if not details else "PARTIAL",
        "proofStatus": "PROVEN" if not details else "UNPROVEN",
        "sampleEmissionAllowed": bool(report.get("sampleEmissionAllowed")) and not details,
        "managedRuntimeClosure": report.get("managedRuntimeClosure"),
        "localRuntimeClosureProofStatus": summary.get("localRuntimeClosureProofStatus"),
        "composeRuntimeClosureProofStatus": summary.get("composeRuntimeClosureProofStatus"),
        "dockerDaemonProofStatus": summary.get("dockerDaemonProofStatus"),
        "failedCheckCount": summary.get("failedCheckCount"),
          "checkReasons": summary.get("checkReasons") or {},
          "failedCheckReasons": summary.get("failedCheckReasons") or {},
          "localRuntimeClosure": summary.get("localRuntimeClosure") or {},
          "composeRuntimeClosure": summary.get("composeRuntimeClosure") or {},
        "reason": "runtime closure permits sampler proof trust"
        if not details
        else "runtime closure does not permit trusted sampler proof",
        "details": details,
    }


def read_local_telemetry_buffer_evidence(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {
            "path": None,
            "status": "pass",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "sampleEmissionAllowed": False,
            "reason": "local telemetry buffer check disabled for this sampler invocation",
        }
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "sourceArtifactKind": LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND,
            "sourcePhase": LOCAL_TELEMETRY_BUFFER_PHASE,
            "sourceBom": LOCAL_TELEMETRY_BUFFER_BOM,
            "sourceSpec": LOCAL_TELEMETRY_BUFFER_SPEC,
            "sourceGate": LOCAL_TELEMETRY_BUFFER_GATE,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": f"local telemetry buffer artifact is missing: {exc}",
            "details": ["local telemetry buffer artifact is missing"],
        }
    except json.JSONDecodeError as exc:
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "sourceArtifactKind": LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND,
            "sourcePhase": LOCAL_TELEMETRY_BUFFER_PHASE,
            "sourceBom": LOCAL_TELEMETRY_BUFFER_BOM,
            "sourceSpec": LOCAL_TELEMETRY_BUFFER_SPEC,
            "sourceGate": LOCAL_TELEMETRY_BUFFER_GATE,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": f"local telemetry buffer artifact is invalid JSON: {exc}",
            "details": ["local telemetry buffer artifact is invalid JSON"],
        }
    summary = report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    details: list[str] = []
    if report.get("artifactKind") != LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if report.get("phase") != LOCAL_TELEMETRY_BUFFER_PHASE:
        details.append("missing or invalid phase")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in LOCAL_TELEMETRY_BUFFER_BOM):
        details.append("missing required local telemetry buffer BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in LOCAL_TELEMETRY_BUFFER_SPEC):
        details.append("missing required local telemetry buffer Spec binding")
    if report.get("completionStatus") != "DONE":
        details.append("local telemetry buffer completionStatus is not DONE")
    if report.get("proofStatus") != "PROVEN":
        details.append("local telemetry buffer proofStatus is not PROVEN")
    issue_breakdown = report.get("issue_breakdown")
    if not isinstance(issue_breakdown, list):
        issue_breakdown = report.get("issueBreakdown") if isinstance(report.get("issueBreakdown"), list) else []
    review_commands = report.get("recommended_review_commands")
    if not isinstance(review_commands, list):
        review_commands = report.get("recommendedReviewCommands") if isinstance(report.get("recommendedReviewCommands"), list) else []
    retention_window = report.get("retentionWindow") if isinstance(report.get("retentionWindow"), dict) else {}
    return {
        "path": str(path),
        "sourceArtifact": str(path),
        "sourceArtifactKind": report.get("sourceArtifactKind") or report.get("artifactKind"),
        "sourcePhase": report.get("sourcePhase") or report.get("phase"),
        "sourceBom": report.get("sourceBom") or report.get("bom", []),
        "sourceSpec": report.get("sourceSpec") or report.get("spec", []),
        "sourceGate": report.get("sourceGate") or report.get("gate"),
        "status": "pass" if not details else "diagnostic incomplete",
        "completionStatus": "DONE" if not details else "PARTIAL",
        "proofStatus": "PROVEN" if not details else "UNPROVEN",
        "sampleEmissionAllowed": report.get("sampleEmissionAllowed"),
        "eventCount": summary.get("eventCount"),
        "droppedCount": summary.get("droppedCount"),
        "observationSourceStatus": summary.get("observationSourceStatus"),
        "observationConsistencyStatus": summary.get("observationConsistencyStatus"),
        "requiredObservationFields": summary.get("requiredObservationFields") or [],
        "presentObservationFields": summary.get("presentObservationFields") or [],
        "missingObservationFields": summary.get("missingObservationFields") or [],
        "observationTemplateJsonPath": summary.get("observationTemplateJsonPath"),
        "observationTemplateMarkdownPath": summary.get("observationTemplateMarkdownPath"),
        "retentionWindowStatus": summary.get("retentionWindowStatus"),
        "retentionWindowProofStatus": summary.get("retentionWindowProofStatus"),
        "retentionWindowMaxEvents": summary.get("retentionWindowMaxEvents"),
        "retentionWindowCapacityProven": summary.get("retentionWindowCapacityProven"),
        "retentionWindowDroppedByKindCountSum": summary.get("retentionWindowDroppedByKindCountSum"),
        "retentionWindowDroppedWithInteractionCountSum": summary.get("retentionWindowDroppedWithInteractionCountSum"),
        "retentionWindowDroppedKindAttributionProven": summary.get("retentionWindowDroppedKindAttributionProven"),
          "retentionWindowDroppedInteractionAttributionValid": summary.get(
              "retentionWindowDroppedInteractionAttributionValid"
          ),
        "retentionWindowTotalObservedOrDroppedCount": summary.get("retentionWindowTotalObservedOrDroppedCount"),
        "retentionWindowDropRatio": summary.get("retentionWindowDropRatio"),
        "retentionWindowRetainedRatio": summary.get("retentionWindowRetainedRatio"),
        "retentionWindowTailWindowOnly": summary.get("retentionWindowTailWindowOnly"),
          "retentionWindowReason": summary.get("retentionWindowReason"),
          "retentionWindow": retention_window,
          "droppedByKind": report.get("droppedByKind") if isinstance(report.get("droppedByKind"), dict) else {},
          "droppedWithInteraction": report.get("droppedWithInteraction")
          if isinstance(report.get("droppedWithInteraction"), dict)
          else {},
          "observationSource": report.get("observationSource"),
        "familyPassCount": summary.get("familyPassCount"),
        "familyUnprovenCount": summary.get("familyUnprovenCount"),
          "issue_breakdown": issue_breakdown,
          "issueBreakdown": issue_breakdown,
          "recommended_review_commands": review_commands,
          "recommendedReviewCommands": review_commands,
        "reason": "local telemetry buffer diagnostics are proven"
        if not details
        else "local telemetry buffer diagnostics remain incomplete",
        "details": details,
    }


def local_telemetry_buffer_blocked_reason(
    local_telemetry_buffer: dict[str, Any],
    review_commands: list[dict[str, str]],
) -> list[dict[str, Any]]:
    if (
        local_telemetry_buffer.get("status") == "pass"
        and local_telemetry_buffer.get("proofStatus") == "PROVEN"
        and local_telemetry_buffer.get("completionStatus") == "DONE"
    ):
        return []
    source_issues = local_telemetry_buffer.get("issue_breakdown") or local_telemetry_buffer.get("issueBreakdown")
    if not isinstance(source_issues, list):
        source_issues = []
    evidence_details: list[Any] = []
    for issue in source_issues:
        if isinstance(issue, dict):
            issue_details = issue.get("evidenceDetails") or issue.get("details")
            if isinstance(issue_details, list):
                evidence_details.extend(issue_details)
            else:
                evidence_details.append(issue)
    if not evidence_details:
        evidence_details = local_telemetry_buffer.get("details") or [local_telemetry_buffer]
    source_review_commands = local_telemetry_buffer.get("recommended_review_commands") or local_telemetry_buffer.get(
        "recommendedReviewCommands"
    )
    if isinstance(source_review_commands, list) and source_review_commands:
        review_commands = source_review_commands
    return [
        {
            "scope": "local-telemetry-buffer",
            "status": local_telemetry_buffer.get("status", "diagnostic incomplete"),
            "completionStatus": local_telemetry_buffer.get("completionStatus", "PARTIAL"),
            "proofStatus": local_telemetry_buffer.get("proofStatus", "UNPROVEN"),
            "reason": "Local telemetry buffer diagnostics do not prove sampler family and interactionId coverage.",
            "sourceArtifact": local_telemetry_buffer.get("sourceArtifact"),
            "sourceArtifactKind": local_telemetry_buffer.get("sourceArtifactKind", LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND),
            "sourcePhase": local_telemetry_buffer.get("sourcePhase", LOCAL_TELEMETRY_BUFFER_PHASE),
            "sourceBom": local_telemetry_buffer.get("sourceBom", LOCAL_TELEMETRY_BUFFER_BOM),
            "sourceSpec": local_telemetry_buffer.get("sourceSpec", LOCAL_TELEMETRY_BUFFER_SPEC),
            "sourceGate": local_telemetry_buffer.get("sourceGate", LOCAL_TELEMETRY_BUFFER_GATE),
            "evidenceDetails": evidence_details,
            "sourceIssueBreakdown": source_issues,
            "retentionWindow": local_telemetry_buffer.get("retentionWindow") or {},
            "requiredObservationFields": local_telemetry_buffer.get("requiredObservationFields") or [],
            "presentObservationFields": local_telemetry_buffer.get("presentObservationFields") or [],
            "missingObservationFields": local_telemetry_buffer.get("missingObservationFields") or [],
            "observationTemplateJsonPath": local_telemetry_buffer.get("observationTemplateJsonPath"),
            "observationTemplateMarkdownPath": local_telemetry_buffer.get("observationTemplateMarkdownPath"),
            "droppedByKind": local_telemetry_buffer.get("droppedByKind") or {},
            "droppedWithInteraction": local_telemetry_buffer.get("droppedWithInteraction") or {},
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }
    ]


def runtime_closure_blocked_reason(
    runtime_closure: dict[str, Any],
    review_commands: list[dict[str, str]],
) -> list[dict[str, Any]]:
    if runtime_closure.get("proofStatus") == "PROVEN" and runtime_closure.get("sampleEmissionAllowed") is True:
        return []
    return [
        {
            "scope": "runtime-closure",
            "status": runtime_closure.get("status", "diagnostic incomplete"),
            "proofStatus": runtime_closure.get("proofStatus", "UNPROVEN"),
            "reason": "Runtime closure does not permit trusted sampler evidence or sample emission.",
            "evidencePath": runtime_closure.get("path"),
            "evidenceStatus": runtime_closure.get("status", "diagnostic incomplete"),
            "sourceArtifact": runtime_closure.get("sourceArtifact") or runtime_closure.get("path"),
            "sourceArtifactKind": runtime_closure.get("sourceArtifactKind") or RUNTIME_CLOSURE_ARTIFACT_KIND,
            "sourcePhase": runtime_closure.get("sourcePhase") or RUNTIME_CLOSURE_PHASE,
            "sourceBom": runtime_closure.get("sourceBom") or RUNTIME_CLOSURE_BOM,
            "sourceSpec": runtime_closure.get("sourceSpec") or RUNTIME_CLOSURE_SPEC,
            "sourceGate": runtime_closure.get("sourceGate") or RUNTIME_CLOSURE_GATE,
            "completionStatus": runtime_closure.get("completionStatus", "PARTIAL"),
            "sourceProofStatus": runtime_closure.get("proofStatus", "UNPROVEN"),
            "blockedDownstreamSteps": [
                "station-mirror-source",
                "sampler:interaction-correlation",
                "sampler:react-commit",
                "sampler:store-update",
                "sampler:overlay-latency",
                "sampler:invoke",
                "sampler:main-thread",
            ],
            "evidenceDetails": runtime_closure.get("details") or [runtime_closure.get("reason")],
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }
    ]


def sampler_trace(report: Any, aggregation_key: str) -> dict[str, Any]:
    trace = report.AGGREGATION_TRACE[aggregation_key]
    return {
        "phase": trace["phase"],
        "bom": trace["bom"],
        "spec": trace["spec"],
        "gate": trace["gate"],
    }


def count_field(evidence: dict[str, Any], *fields: str) -> int:
    for field in fields:
        value = evidence.get(field)
        if isinstance(value, int):
            return value
    return 0


def normalize_sampler(
    *,
    sampler_id: str,
    trace: dict[str, Any],
    evidence: dict[str, Any],
    station_evidence: dict[str, Any],
    station_source: dict[str, Any],
    source_artifact_kind: str,
    required_event_kinds: list[str],
) -> dict[str, Any]:
    status = evidence.get("status", "diagnostic incomplete")
    proof_status = evidence.get("proofStatus", "UNPROVEN")
    source_artifact = station_evidence["path"]
    source_completion = station_source.get("completionStatus", "PARTIAL")
    source_proof = station_source.get("proofStatus", "UNPROVEN")
    return {
        "samplerId": sampler_id,
        "status": status,
        "completionStatus": "DONE" if status == "loaded" and proof_status == "PROVEN" else "PARTIAL",
        "proofStatus": proof_status,
        "phase": trace["phase"],
        "bom": trace["bom"],
        "spec": trace["spec"],
        "gate": trace["gate"],
        "sourceArtifact": source_artifact,
        "sourceArtifactKind": station_source.get("artifactKind") or source_artifact_kind,
        "sourcePhase": trace["phase"],
        "sourceBom": trace["bom"],
        "sourceSpec": trace["spec"],
        "sourceGate": trace["gate"],
        "sourceCompletionStatus": source_completion,
        "sourceProofStatus": source_proof,
        "requiredEventKinds": required_event_kinds,
        "eventCount": count_field(evidence, "trackedEventCount", "commitCount", "updateCount", "eventCount", "intentCount"),
        "linkedEventCount": evidence.get("linkedEventCount"),
        "unlinkedEventCount": evidence.get("unlinkedEventCount"),
        "evidencePath": station_evidence["path"],
        "evidenceStatus": station_evidence["status"],
        "reason": evidence.get("reason", "sampler evidence is not proven"),
        "details": [
            {
                "samplerId": sampler_id,
                "status": status,
                "proofStatus": proof_status,
                "evidencePath": station_evidence["path"],
                "evidenceStatus": station_evidence["status"],
                  "sourceArtifact": source_artifact,
                  "sourceArtifactKind": station_source.get("artifactKind") or source_artifact_kind,
                  "sourcePhase": trace["phase"],
                  "sourceBom": trace["bom"],
                  "sourceSpec": trace["spec"],
                  "sourceGate": trace["gate"],
                  "sourceCompletionStatus": source_completion,
                  "sourceProofStatus": source_proof,
                "requiredEventKinds": required_event_kinds,
                "eventCount": count_field(evidence, "trackedEventCount", "commitCount", "updateCount", "eventCount", "intentCount"),
            }
        ],
        "summary": {
            key: value
            for key, value in evidence.items()
            if key
            in {
                "commitCount",
                "updateCount",
                "intentCount",
                "visibleCount",
                "pairedVisibleCount",
                "missingVisibleCount",
                "terminalCount",
                "failedCount",
                "violationCount",
                "exceptionCount",
                "maxDurationMs",
                "maxVisibleLatencyMs",
                "unknownAttributionCount",
            }
        },
    }


def dom_anchor_blocked_reasons(
    *,
    dom_anchor_gate_report: dict[str, Any] | None,
    dom_anchor_gate_evidence: dict[str, Any],
    review_commands: list[dict[str, str]],
) -> list[dict[str, Any]]:
    if not isinstance(dom_anchor_gate_report, dict):
        return []
    summary = dom_anchor_gate_report.get("summary")
    if not isinstance(summary, dict):
        return []
    blocked_runtime_cells = summary.get("blockedRuntimeCells")
    if not isinstance(blocked_runtime_cells, list):
        return []
    reasons: list[dict[str, Any]] = []
    for cell in blocked_runtime_cells:
        if not isinstance(cell, dict):
            continue
        runtime_cell = str(cell.get("runtimeCell") or "unknown")
        blocked_by_step = str(cell.get("blockedByStep") or f"{runtime_cell}.dom_anchors")
        reasons.append(
            {
                "scope": f"dom-anchor:{runtime_cell}",
                "status": dom_anchor_gate_report.get("status", "diagnostic incomplete"),
                "proofStatus": cell.get("proofStatus", dom_anchor_gate_report.get("proofStatus", "UNPROVEN")),
                "reason": f"{blocked_by_step} is not proven; sampler collection and Station sampler mirror remain blocked.",
                "evidencePath": dom_anchor_gate_evidence.get("path"),
                "evidenceStatus": dom_anchor_gate_evidence.get("status"),
                "sourceArtifact": dom_anchor_gate_evidence.get("path"),
                "sourceArtifactKind": dom_anchor_gate_report.get("artifactKind", "desktop-anchor-dom-evidence-gate"),
                "sourcePhase": "P0b-1",
                "sourceBom": ["BOM-SMP-01"],
                "sourceSpec": ["SPEC-ANCHOR-01"],
                "sourceGate": cell.get(
                    "blockedByGate",
                    "Native Tauri DOM automation must prove every required anchor by selector and count",
                ),
                "completionStatus": dom_anchor_gate_report.get("completionStatus", "PARTIAL"),
                "sourceProofStatus": dom_anchor_gate_report.get("proofStatus", "UNPROVEN"),
                "blockedByStep": blocked_by_step,
                "blockedDownstreamSteps": cell.get("blockedDownstreamSteps") or summary.get("blockedDownstreamSteps") or [],
                "evidenceDetails": [
                    {
                        "runtimeCell": runtime_cell,
                        "blockedByStep": blocked_by_step,
                        "provenCount": cell.get("provenCount"),
                        "requiredCount": cell.get("requiredCount"),
                        "missingAnchors": cell.get("missingAnchors") or [],
                    }
                ],
                "recommended_review_commands": review_commands,
                "recommendedReviewCommands": review_commands,
            }
        )
    return reasons


def build_report(
    station_mirror_report: Path,
    anchor_dom_evidence_gate_report: Path | None = None,
    runtime_closure_report: Path | None = None,
    local_telemetry_buffer_report: Path | None = None,
) -> dict[str, Any]:
    report = load_report_module()
    station_report, station_evidence = report.read_json_if_present(station_mirror_report)
    runtime_closure = read_runtime_closure_evidence(runtime_closure_report)
    local_telemetry_buffer = read_local_telemetry_buffer_evidence(local_telemetry_buffer_report)
    dom_anchor_gate_report: dict[str, Any] | None = None
    dom_anchor_gate_evidence: dict[str, Any] = {}
    if anchor_dom_evidence_gate_report is not None:
        dom_anchor_gate_report, dom_anchor_gate_evidence = report.read_json_if_present(anchor_dom_evidence_gate_report)
    station_source = report.station_mirror_source_state(station_report, station_evidence)
    mirror_artifact_kind = getattr(report, "MIRROR_REQUIRED_ARTIFACT_KIND", "desktop-performance-station-mirror")
    mirror_phase = getattr(report, "MIRROR_REQUIRED_PHASE", "P0a-6/P0c-5")
    mirror_bom = list(getattr(report, "MIRROR_REQUIRED_BOM", ("BOM-CAP-05", "BOM-RUN-05")))
    mirror_spec = list(getattr(report, "MIRROR_REQUIRED_SPEC", ("SPEC-STA-03", "SPEC-MIRROR-01")))
    mirror_gate = station_source.get("gate") or "Station mirror artifact must preserve Station query evidence"
    samplers = [
        normalize_sampler(
            sampler_id="interaction-correlation",
            trace={
                "phase": "P0b-2/P0c-5",
                "bom": ["BOM-CON-02", "BOM-CAP-03", "BOM-RUN-05", "BOM-CAP-05"],
                "spec": ["SPEC-INT-01", "SPEC-MIRROR-01", "SPEC-STA-03"],
                "gate": "Interaction-correlated sampler event families must carry interactionId",
            },
            evidence=report.interaction_correlation_summary(station_report),
            station_evidence=station_evidence,
              station_source=station_source,
              source_artifact_kind=mirror_artifact_kind,
            required_event_kinds=sorted(report.INTERACTION_CORRELATION_EVENT_KINDS),
        ),
        normalize_sampler(
            sampler_id="react-commit",
            trace=sampler_trace(report, "reactCommitAggregation"),
            evidence=report.react_commit_aggregation(station_report),
            station_evidence=station_evidence,
              station_source=station_source,
              source_artifact_kind=mirror_artifact_kind,
            required_event_kinds=["react.commit"],
        ),
        normalize_sampler(
            sampler_id="store-update",
            trace=sampler_trace(report, "storeUpdateAggregation"),
            evidence=report.store_update_aggregation(station_report),
            station_evidence=station_evidence,
              station_source=station_source,
              source_artifact_kind=mirror_artifact_kind,
            required_event_kinds=["store.update"],
        ),
        normalize_sampler(
            sampler_id="overlay-latency",
            trace=sampler_trace(report, "overlayLatencyAggregation"),
            evidence=report.overlay_latency_aggregation(station_report),
            station_evidence=station_evidence,
              station_source=station_source,
              source_artifact_kind=mirror_artifact_kind,
            required_event_kinds=["contextmenu.intent", "overlay.visible"],
        ),
        normalize_sampler(
            sampler_id="invoke",
            trace=sampler_trace(report, "invokeAggregation"),
            evidence=report.invoke_aggregation(station_report),
            station_evidence=station_evidence,
              station_source=station_source,
              source_artifact_kind=mirror_artifact_kind,
            required_event_kinds=["invoke.started", "invoke.completed|invoke.failed"],
        ),
        normalize_sampler(
            sampler_id="main-thread",
            trace=sampler_trace(report, "mainThreadExceptions"),
            evidence=report.main_thread_exception_summary(station_report),
            station_evidence=station_evidence,
              station_source=station_source,
              source_artifact_kind=mirror_artifact_kind,
            required_event_kinds=sorted(report.MAIN_THREAD_EVENT_KINDS),
        ),
    ]
    runtime_blocked = runtime_closure_blocked_reason(
        runtime_closure,
        recommended_review_commands(station_mirror_report),
    )
    local_buffer_blocked = local_telemetry_buffer_blocked_reason(
        local_telemetry_buffer,
        recommended_review_commands(station_mirror_report),
    )
    review_commands = [] if station_source["status"] == "loaded" and not runtime_blocked else recommended_review_commands(station_mirror_report)
    dom_blocked = dom_anchor_blocked_reasons(
        dom_anchor_gate_report=dom_anchor_gate_report,
        dom_anchor_gate_evidence=dom_anchor_gate_evidence,
        review_commands=review_commands or recommended_review_commands(station_mirror_report),
    )
    passed = (
        not runtime_blocked
        and not local_buffer_blocked
        and not dom_blocked
        and station_source["status"] == "loaded"
        and all(
            sampler["status"] == "loaded" and sampler["proofStatus"] == "PROVEN"
            for sampler in samplers
        )
    )
    status = "pass" if passed else "diagnostic incomplete"
    if not passed and not review_commands:
        review_commands = recommended_review_commands(station_mirror_report)
    blocked = [
        {
            "scope": f"sampler:{sampler['samplerId']}",
            "status": sampler["status"],
            "proofStatus": sampler["proofStatus"],
            "reason": sampler["reason"],
            "evidencePath": sampler["evidencePath"],
            "evidenceStatus": sampler["evidenceStatus"],
              "sourceArtifact": sampler["sourceArtifact"],
              "sourceArtifactKind": sampler["sourceArtifactKind"],
              "sourcePhase": sampler["sourcePhase"],
              "sourceBom": sampler["sourceBom"],
              "sourceSpec": sampler["sourceSpec"],
              "sourceGate": sampler["sourceGate"],
              "completionStatus": sampler["sourceCompletionStatus"],
              "sourceProofStatus": sampler["sourceProofStatus"],
            "evidenceDetails": sampler["details"],
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }
        for sampler in samplers
        if sampler["status"] != "loaded" or sampler["proofStatus"] != "PROVEN"
    ]
    blocked = runtime_blocked + local_buffer_blocked + dom_blocked + blocked
    if station_source["status"] != "loaded":
        station_review_commands = station_source.get(
            "recommended_review_commands",
            station_source.get("recommendedReviewCommands", review_commands),
        )
        if not isinstance(station_review_commands, list):
            station_review_commands = review_commands
        blocked.insert(
            0,
            {
                "scope": "station-mirror-source",
                "status": station_source["status"],
                "proofStatus": station_source["proofStatus"],
                "reason": station_source["reason"],
                "evidencePath": station_source["evidencePath"],
                "evidenceStatus": station_source["evidenceStatus"],
                "sourceArtifact": station_source["evidencePath"],
                "sourceArtifactKind": station_source.get("artifactKind") or mirror_artifact_kind,
                "sourcePhase": station_source.get("phase") or mirror_phase,
                "sourceBom": station_source.get("bom") or mirror_bom,
                "sourceSpec": station_source.get("spec") or mirror_spec,
                "sourceGate": mirror_gate,
                "completionStatus": station_source.get("completionStatus", "PARTIAL"),
                "sourceProofStatus": station_source.get("proofStatus", "UNPROVEN"),
                "evidenceDetails": station_source.get("details") or [station_source["reason"]],
                "recommended_review_commands": station_review_commands,
                "recommendedReviewCommands": station_review_commands,
            },
        )
    blocked = normalize_blocked_reasons(blocked)
    issue_breakdown = [issue_from_blocked_reason(item, review_commands) for item in blocked]
    reason = sampler_gate_reason(blocked)
    summary = sampler_gate_summary(
        station_source=station_source,
        samplers=samplers,
        blocked=blocked,
        sample_emission_allowed=passed,
        dom_anchor_gate=dom_anchor_gate_report,
        runtime_closure=runtime_closure,
        local_telemetry_buffer=local_telemetry_buffer,
    )
    report_payload = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "artifactKind": "desktop-performance-sampler-gate",
        "sourceArtifactKind": "desktop-performance-sampler-gate",
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "status": status,
        "completionStatus": "DONE" if passed else "PARTIAL",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "sampleEmissionAllowed": passed,
        "reason": reason,
        "summary": summary,
        "runtimeClosure": runtime_closure,
          "localTelemetryBuffer": local_telemetry_buffer,
        "stationMirrorSource": station_source,
        "domAnchorGate": dom_anchor_gate_report or {},
        "samplers": samplers,
        "blockedReasons": blocked,
    }
    if issue_breakdown:
        report_payload["issue_breakdown"] = issue_breakdown
        report_payload["issueBreakdown"] = issue_breakdown
        primary = issue_breakdown[0]
        failed_step = primary.get("failedStep")
        summary_text = primary.get("summary")
        if failed_step:
            report_payload["failedStep"] = failed_step
            report_payload["summary"]["failedStep"] = failed_step
        if summary_text:
            report_payload["summary"]["reason"] = summary_text
        for key in ("category", "sourceArtifact", "sourceArtifactKind", "sourcePhase", "sourceBom", "sourceSpec", "sourceGate"):
            value = primary.get(key)
            if value is not None:
                report_payload["summary"][f"primaryIssue{key[0].upper()}{key[1:]}"] = value
    if review_commands:
        report_payload["recommended_review_commands"] = review_commands
        report_payload["recommendedReviewCommands"] = review_commands
    return report_payload


def format_list(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(str(item) for item in value)
    if value is None:
        return "n/a"
    return str(value)


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Performance Sampler Gate",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Status: `{report['status']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Phase: `{report['phase']}`",
        f"- BOM: `{format_list(report['bom'])}`",
        f"- Spec: `{format_list(report['spec'])}`",
        f"- Gate: `{report['gate']}`",
        f"- Source kind: `{report.get('sourceArtifactKind')}`",
        f"- Source phase: `{report.get('sourcePhase')}`",
        f"- Source BOM: `{format_list(report.get('sourceBom'))}`",
        f"- Source Spec: `{format_list(report.get('sourceSpec'))}`",
        f"- Source Gate: `{report.get('sourceGate')}`",
        f"- Sample emission allowed: `{report['sampleEmissionAllowed']}`",
        f"- Reason: `{report['reason']}`",
        f"- Sampler families: `{report.get('summary', {}).get('samplerFamilyCount', 'n/a')}`",
        f"- Proven samplers: `{report.get('summary', {}).get('provenSamplerCount', 'n/a')}`",
        f"- Unproven samplers: `{report.get('summary', {}).get('unprovenSamplerCount', 'n/a')}`",
        f"- Blocked scopes: `{format_list(report.get('summary', {}).get('blockedScopes', []))}`",
        f"- DOM anchor gate: `{report.get('summary', {}).get('domAnchorGateStatus')}`",
        f"- DOM anchor proof: `{report.get('summary', {}).get('domAnchorGateProofStatus')}`",
        f"- DOM anchor blocked by steps: `{format_list(report.get('summary', {}).get('domAnchorBlockedBySteps'))}`",
        f"- DOM anchor blocked downstream steps: `{format_list(report.get('summary', {}).get('domAnchorBlockedDownstreamSteps'))}`",
          f"- Local telemetry buffer: `{report.get('summary', {}).get('localTelemetryBufferStatus')}`",
          f"- Local telemetry buffer proof: `{report.get('summary', {}).get('localTelemetryBufferProofStatus')}`",
          f"- Local telemetry buffer sample emission allowed: `{report.get('summary', {}).get('localTelemetryBufferSampleEmissionAllowed')}`",
          f"- Local telemetry buffer retention window: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowStatus')}`",
          f"- Local telemetry buffer tail only: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowTailWindowOnly')}`",
          f"- Local telemetry buffer retention reason: `{report.get('summary', {}).get('localTelemetryBufferRetentionWindowReason')}`",
          f"- Local telemetry buffer missing observation fields: `{format_list(report.get('summary', {}).get('localTelemetryBufferMissingObservationFields'))}`",
          f"- Local telemetry buffer observation template JSON: `{report.get('summary', {}).get('localTelemetryBufferObservationTemplateJsonPath')}`",
          f"- Local telemetry buffer dropped byKind: `{json.dumps(report.get('summary', {}).get('localTelemetryBufferDroppedByKind') or {}, sort_keys=True, ensure_ascii=False)}`",
          f"- Local telemetry buffer dropped withInteraction: `{json.dumps(report.get('summary', {}).get('localTelemetryBufferDroppedWithInteraction') or {}, sort_keys=True, ensure_ascii=False)}`",
        f"- Runtime closure proof: `{report.get('summary', {}).get('runtimeClosureProofStatus')}`",
        f"- Runtime closure sample emission allowed: `{report.get('summary', {}).get('runtimeClosureSampleEmissionAllowed')}`",
        f"- Runtime closure Docker daemon proof: `{report.get('summary', {}).get('runtimeClosureDockerDaemonProofStatus')}`",
          f"- Runtime closure failed check reasons: `{json.dumps(report.get('summary', {}).get('runtimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
          f"- Runtime closure local closure proof: `{(report.get('summary', {}).get('runtimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
          f"- Runtime closure compose closure proof: `{(report.get('summary', {}).get('runtimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
        "",
        "## Runtime Closure",
        "",
        f"- Status: `{report.get('runtimeClosure', {}).get('status')}`",
        f"- Completion: `{report.get('runtimeClosure', {}).get('completionStatus', 'n/a')}`",
        f"- Proof: `{report.get('runtimeClosure', {}).get('proofStatus')}`",
        f"- Source artifact: `{report.get('runtimeClosure', {}).get('sourceArtifact')}`",
        f"- Source kind: `{report.get('runtimeClosure', {}).get('sourceArtifactKind')}`",
        f"- Source phase: `{report.get('runtimeClosure', {}).get('sourcePhase')}`",
        f"- Source BOM: `{format_list(report.get('runtimeClosure', {}).get('sourceBom'))}`",
        f"- Source Spec: `{format_list(report.get('runtimeClosure', {}).get('sourceSpec'))}`",
        f"- Source Gate: `{report.get('runtimeClosure', {}).get('sourceGate')}`",
        f"- Managed runtime: `{report.get('runtimeClosure', {}).get('managedRuntimeClosure')}`",
        f"- Docker daemon proof: `{report.get('runtimeClosure', {}).get('dockerDaemonProofStatus')}`",
          f"- Failed check reasons: `{json.dumps(report.get('runtimeClosure', {}).get('failedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
        f"- Reason: `{report.get('runtimeClosure', {}).get('reason')}`",
        "",
        "## Station Mirror Source",
        "",
        f"- Status: `{report['stationMirrorSource']['status']}`",
        f"- Completion: `{report['stationMirrorSource'].get('completionStatus', 'n/a')}`",
        f"- Proof: `{report['stationMirrorSource']['proofStatus']}`",
        f"- Evidence: `{report['stationMirrorSource']['evidencePath']}`",
        f"- Source kind: `{report['stationMirrorSource'].get('artifactKind', 'desktop-performance-station-mirror')}`",
        f"- Phase: `{report['stationMirrorSource'].get('phase', 'n/a')}`",
        f"- BOM: `{format_list(report['stationMirrorSource'].get('bom'))}`",
        f"- Spec: `{format_list(report['stationMirrorSource'].get('spec'))}`",
        f"- Gate: `{report['stationMirrorSource'].get('gate', 'n/a')}`",
        f"- Details: `{format_list(report['stationMirrorSource'].get('details', []))}`",
        "",
        "## Samplers",
        "",
          "| Sampler | Status | Proof | Events | Source Artifact | Source Kind | Source Proof | Phase | BOM | Spec | Gate | Evidence | Reason |",
          "|---|---|---|---:|---|---|---|---|---|---|---|---|---|",
    ]
    for sampler in report["samplers"]:
        lines.append(
              "| `{sampler}` | `{status}` | `{proof}` | `{events}` | `{source_artifact}` | `{source_kind}` | `{source_proof}` | `{phase}` | `{bom}` | `{spec}` | `{gate}` | `{evidence}` | {reason} |".format(
                sampler=sampler["samplerId"],
                status=sampler["status"],
                proof=sampler["proofStatus"],
                events=sampler["eventCount"],
                  source_artifact=sampler.get("sourceArtifact"),
                  source_kind=sampler.get("sourceArtifactKind"),
                  source_proof=sampler.get("sourceProofStatus"),
                  phase=sampler["sourcePhase"],
                  bom=format_list(sampler["sourceBom"]),
                  spec=format_list(sampler["sourceSpec"]),
                  gate=sampler["sourceGate"],
                evidence=sampler["evidenceStatus"],
                reason=sampler["reason"],
            )
        )
    if report["blockedReasons"]:
        lines.extend(
            [
                "",
                "## Blocked Reasons",
                "",
                "| Scope | Status | Proof | Evidence | Source Artifact | Source Kind | Source Completion | Source Proof | Phase | BOM | Spec | Reason |",
                "|---|---|---|---|---|---|---|---|---|---|---|---|",
            ]
        )
        for item in report["blockedReasons"]:
            lines.append(
                "| `{scope}` | `{status}` | `{proof}` | `{evidence}` | `{source_artifact}` | `{source_kind}` | `{source_completion}` | `{source_proof}` | `{phase}` | `{bom}` | `{spec}` | {reason} |".format(
                    scope=item.get("scope", "n/a"),
                    status=item.get("status", "n/a"),
                    proof=item.get("proofStatus", "n/a"),
                    evidence=item.get("evidencePath", "n/a"),
                    source_artifact=item.get("sourceArtifact", "n/a"),
                    source_kind=item.get("sourceArtifactKind", "n/a"),
                    source_completion=item.get("completionStatus", "n/a"),
                    source_proof=item.get("sourceProofStatus", "n/a"),
                    phase=item.get("sourcePhase", "n/a"),
                    bom=format_list(item.get("sourceBom")),
                    spec=format_list(item.get("sourceSpec")),
                    reason=item.get("reason", "n/a"),
                )
            )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- This gate reads Station mirror telemetry only.",
            "- It does not launch runtime automation or alter Shell/PageHost/Store/Overlay behavior.",
            "- Missing live samples remain `PARTIAL/UNPROVEN`.",
        ]
    )
    return "\n".join(lines) + "\n"


def build_local_telemetry_buffer_observations_template() -> dict[str, Any]:
    by_kind = {
        event_kind: 0
        for event_kinds in LOCAL_TELEMETRY_BUFFER_REQUIRED_FAMILIES.values()
        for event_kind in event_kinds
    }
    issue = {
        "category": "local-telemetry-buffer-observation-template",
        "failedStep": "local-telemetry-buffer-observations",
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "summary": "Local Desktop telemetry buffer observations have not been collected from window.__PT_FRONTEND_TELEMETRY__.",
        "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN until live local buffer observations prove required families and interactionId coverage.",
        "sourceArtifact": str(LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_JSON),
        "sourceArtifactKind": LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND,
        "sourcePhase": LOCAL_TELEMETRY_BUFFER_PHASE,
        "sourceBom": LOCAL_TELEMETRY_BUFFER_BOM,
        "sourceSpec": LOCAL_TELEMETRY_BUFFER_SPEC,
        "sourceGate": LOCAL_TELEMETRY_BUFFER_GATE,
    }
    return {
        "schemaVersion": 1,
        "artifactKind": LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "sourceArtifact": str(LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_JSON),
        "sourceArtifactKind": LOCAL_TELEMETRY_BUFFER_ARTIFACT_KIND,
        "sourcePhase": LOCAL_TELEMETRY_BUFFER_PHASE,
        "sourceBom": LOCAL_TELEMETRY_BUFFER_BOM,
        "sourceSpec": LOCAL_TELEMETRY_BUFFER_SPEC,
        "sourceGate": LOCAL_TELEMETRY_BUFFER_GATE,
        "phase": LOCAL_TELEMETRY_BUFFER_PHASE,
        "bom": LOCAL_TELEMETRY_BUFFER_BOM,
        "spec": LOCAL_TELEMETRY_BUFFER_SPEC,
        "gate": LOCAL_TELEMETRY_BUFFER_GATE,
        "targetObservationPath": LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_PATH,
        "collectionProtocol": [
            "start the Native Desktop runtime through make desktop",
            "authenticate in the Native Desktop window if required",
            "run window.__PT_FRONTEND_TELEMETRY__.clear() immediately before sampling",
            "perform primary-nav, secondary-tab, and context-menu interactions",
            "copy JSON.stringify(window.__PT_FRONTEND_TELEMETRY__.snapshot(), null, 2)",
            f"write the copied JSON to {LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_PATH}",
            "run the local telemetry buffer gate before trusting sampler evidence",
        ],
        "requiredFamilies": LOCAL_TELEMETRY_BUFFER_REQUIRED_FAMILIES,
        "requiredObservationFields": LOCAL_TELEMETRY_BUFFER_REQUIRED_OBSERVATION_FIELDS,
        "summary": {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "targetObservationPath": LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_PATH,
            "requiredObservationFields": LOCAL_TELEMETRY_BUFFER_REQUIRED_OBSERVATION_FIELDS,
        },
        "issue_breakdown": [issue],
        "issueBreakdown": [issue],
        "template": {
            "source": "window.__PT_FRONTEND_TELEMETRY__",
            "runtime": "tauri-webview-dev",
            "url": "",
            "readyState": "",
            "eventCount": 0,
            "maxEvents": 0,
            "droppedCount": 0,
            "byKind": by_kind,
            "withInteraction": {},
            "droppedByKind": {},
            "droppedWithInteraction": {},
        },
        "failClosedRules": [
            "source must equal window.__PT_FRONTEND_TELEMETRY__",
            "eventCount must equal the sum of positive byKind counts",
            "withInteraction counts must not exceed byKind counts",
            "droppedCount must be 0 for a proven local buffer diagnostic",
            "withInteraction must prove interactionId coverage for required interaction-correlated families",
        ],
    }


def render_local_telemetry_buffer_observations_template_markdown(template: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Desktop Local Telemetry Buffer Observations Template",
            "",
            f"- Status: `{template['status']}`",
            f"- Completion: `{template['completionStatus']}`",
            f"- Proof: `{template['proofStatus']}`",
            f"- Sample emission allowed: `{template['sampleEmissionAllowed']}`",
            f"- Target observation path: `{template['targetObservationPath']}`",
            f"- Phase: `{template['phase']}`",
            f"- BOM: `{format_list(template['bom'])}`",
            f"- Spec: `{format_list(template['spec'])}`",
            f"- Gate: `{template['gate']}`",
            "",
        ]
    )


def write_local_telemetry_buffer_observations_template(output_dir: Path) -> tuple[Path, Path]:
    template = build_local_telemetry_buffer_observations_template()
    json_path = output_dir / Path(LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_JSON).name
    markdown_path = output_dir / Path(LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_MD).name
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(template, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    markdown_path.write_text(
        render_local_telemetry_buffer_observations_template_markdown(template),
        encoding="utf-8",
    )
    return json_path, markdown_path


def write_outputs(report: dict[str, Any], output_prefix: Path) -> tuple[Path, Path]:
    output_prefix = explicit_output_path(output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    write_local_telemetry_buffer_observations_template(output_prefix.parent)
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--station-mirror-report",
    )
    parser.add_argument(
        "--anchor-dom-evidence-gate-report",
    )
    parser.add_argument(
        "--runtime-closure-report",
    )
    parser.add_argument(
        "--local-telemetry-buffer-report",
    )
    parser.add_argument(
        "--output-prefix",
    )
    args = parser.parse_args()

    defaults = {
        "station_mirror_report": ("desktop-telemetry-mirror-template-gate", "report"),
        "anchor_dom_evidence_gate_report": (
            "desktop-anchor-dom-evidence-gate",
            "report",
        ),
        "runtime_closure_report": (
            "desktop-telemetry-runtime-closure-gate",
            "report",
        ),
        "local_telemetry_buffer_report": (
            "desktop-local-telemetry-buffer-gate",
            "report",
        ),
    }
    input_refs: dict[str, Any] = {}
    resolved_refs: dict[Path, dict[str, Any]] = {}
    for attribute, (gate_id, role) in defaults.items():
        if getattr(args, attribute) is None:
            resolved_path, artifact_ref = latest_artifact(gate_id, role)
            setattr(args, attribute, str(resolved_path))
            input_refs[attribute] = artifact_ref
            resolved_refs[resolved_path] = artifact_ref
    report = build_report(
        Path(args.station_mirror_report),
        Path(args.anchor_dom_evidence_gate_report),
        Path(args.runtime_closure_report),
        Path(args.local_telemetry_buffer_report),
    )
    if input_refs:
        report["inputArtifactRefs"] = input_refs
    report = replace_resolved_artifact_paths(report, resolved_refs)
    if args.output_prefix:
        json_path, md_path = write_outputs(report, Path(args.output_prefix))
        display_json = str(json_path)
        display_markdown = str(md_path)
    else:
        template = build_local_telemetry_buffer_observations_template()
        with artifact_session(PRODUCER_GATE_ID) as session:
            session.write_json(DEFAULT_OUTPUT_PREFIX + ".json", report, role="report")
            session.write_bytes(
                DEFAULT_OUTPUT_PREFIX + ".md",
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role="report-markdown",
            )
            session.write_json(
                LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_JSON,
                template,
                role="observations-template",
            )
            session.write_bytes(
                LOCAL_TELEMETRY_BUFFER_OBSERVATIONS_TEMPLATE_MD,
                render_local_telemetry_buffer_observations_template_markdown(template).encode("utf-8"),
                media_type="text/markdown",
                role="observations-template-markdown",
            )
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_json = DEFAULT_OUTPUT_PREFIX + ".json"
        display_markdown = DEFAULT_OUTPUT_PREFIX + ".md"
    print(f"desktop performance sampler gate JSON: {display_json}")
    print(f"desktop performance sampler gate Markdown: {display_markdown}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
