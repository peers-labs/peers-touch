#!/usr/bin/env python3
"""Validate Phase 0 Desktop performance issue traceability."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import (
    artifact_session,
    explicit_output_path,
    latest_artifact,
    replace_resolved_artifact_paths,
)


ARTIFACT_KIND = "desktop-performance-traceability-gate"
PHASE = "P0c-5"
BOM = ["BOM-RUN-05", "BOM-CAP-05", "BOM-GATE-02"]
SPEC = ["SPEC-MIRROR-01", "SPEC-STA-03", "SPEC-GATE-02"]
GATE = "Phase 0 aggregate issue and result evidence must preserve source artifact, phase, BOM, Spec, and Gate traceability"
DEFAULT_OUTPUT = "reports/desktop-performance-traceability-gate.json"
REQUIRED_ISSUE_FIELDS = [
    "sourceArtifact",
    "sourceArtifactKind",
    "sourcePhase",
    "sourceBom",
    "sourceSpec",
    "sourceGate",
]
ROUTE_EVIDENCE_SOURCE_FIELDS = [
    "Artifact",
    "Kind",
    "Phase",
    "Bom",
    "Spec",
    "Gate",
]
RAW_EVIDENCE_SUMMARY_FIELDS = [
    "rawEvidencePath",
    "rawSourceArtifactKind",
    "rawSourcePhase",
    "rawSourceBom",
    "rawSourceSpec",
    "rawSourceGate",
]
SOURCE_TRACE_FIELD_SET = set(REQUIRED_ISSUE_FIELDS)
DEFAULT_INPUT_ROLES = (
    ("acceptance-run", "run"),
    (
        "desktop-performance-report-gate",
        "report",
    ),
    (
        "desktop-performance-matrix-gate",
        "report",
    ),
)


def default_inputs_with_refs() -> tuple[list[str], dict[Path, dict[str, Any]]]:
    inputs: list[str] = []
    resolved_refs: dict[Path, dict[str, Any]] = {}
    for gate_id, role in DEFAULT_INPUT_ROLES:
        resolved_path, artifact_ref = latest_artifact(gate_id, role)
        inputs.append(str(resolved_path))
        resolved_refs[resolved_path] = artifact_ref
    return inputs, resolved_refs


def default_inputs() -> list[str]:
    inputs, _ = default_inputs_with_refs()
    return inputs


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def issue_values_valid(issue: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for field in REQUIRED_ISSUE_FIELDS:
        value = issue.get(field)
        if value is None:
            missing.append(field)
            continue
        if isinstance(value, str) and not value:
            missing.append(field)
            continue
        if isinstance(value, list) and not value:
            missing.append(field)
            continue
    return missing


def value_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value:
        return True
    if isinstance(value, list) and not value:
        return True
    return False


def route_evidence_source_traceability(summary: dict[str, Any]) -> list[dict[str, Any]]:
    missing_traceability: list[dict[str, Any]] = []
    prefixes = sorted(
        {
            key.removesuffix("RouteEvidenceSourceArtifact")
            for key in summary
            if key.endswith("RouteEvidenceSourceArtifact")
        }
        | {
            key.removesuffix("RouteEvidenceSourceKind")
            for key in summary
            if key.endswith("RouteEvidenceSourceKind")
        }
    )
    for prefix in prefixes:
        missing_fields = [
            f"{prefix}RouteEvidenceSource{field}"
            for field in ROUTE_EVIDENCE_SOURCE_FIELDS
            if value_missing(summary.get(f"{prefix}RouteEvidenceSource{field}"))
        ]
        if missing_fields:
            missing_traceability.append(
                {
                    "category": "nested-route-evidence-source",
                    "failedStep": f"{prefix}route-evidence-source",
                    "missingFields": missing_fields,
                    "sourceArtifactKind": summary.get(f"{prefix}RouteEvidenceSourceKind"),
                    "sourcePhase": summary.get(f"{prefix}RouteEvidenceSourcePhase"),
                    "reason": "route evidence source summary is missing source traceability",
                }
            )
    return missing_traceability


def sample_blocker_traceability(value: Any, path: str = "$") -> list[dict[str, Any]]:
    missing_traceability: list[dict[str, Any]] = []
    if isinstance(value, dict):
        sample_blockers = value.get("sampleBlockers")
        if isinstance(sample_blockers, list):
            for index, blocker in enumerate(sample_blockers):
                if not isinstance(blocker, dict):
                    continue
                missing_fields = [
                    field
                    for field in REQUIRED_ISSUE_FIELDS
                    if value_missing(blocker.get(field))
                ]
                if missing_fields:
                    missing_traceability.append(
                        {
                            "category": "nested-sample-blocker",
                            "failedStep": f"{path}.sampleBlockers[{index}]",
                            "scope": blocker.get("scope"),
                            "missingFields": missing_fields,
                            "sourceArtifactKind": blocker.get("sourceArtifactKind"),
                            "sourcePhase": blocker.get("sourcePhase"),
                            "reason": "sample blocker is missing source traceability",
                        }
                    )
        for key, nested_value in value.items():
            missing_traceability.extend(sample_blocker_traceability(nested_value, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, nested_value in enumerate(value):
            missing_traceability.extend(sample_blocker_traceability(nested_value, f"{path}[{index}]"))
    return missing_traceability


def raw_evidence_traceability(value: Any, path: str = "$") -> list[dict[str, Any]]:
    missing_traceability: list[dict[str, Any]] = []
    if isinstance(value, dict):
        raw_evidence = value.get("rawEvidence")
        if isinstance(raw_evidence, dict):
            missing_fields = [
                field
                for field in REQUIRED_ISSUE_FIELDS
                if value_missing(raw_evidence.get(field))
            ]
            if missing_fields:
                missing_traceability.append(
                    {
                        "category": "nested-raw-evidence",
                        "failedStep": f"{path}.rawEvidence",
                        "missingFields": missing_fields,
                        "sourceArtifactKind": raw_evidence.get("sourceArtifactKind"),
                        "sourcePhase": raw_evidence.get("sourcePhase"),
                        "reason": "red-line raw evidence is missing source traceability",
                    }
                )
        if "rawEvidencePath" in value or "rawSourceArtifactKind" in value:
            missing_fields = [
                field
                for field in RAW_EVIDENCE_SUMMARY_FIELDS
                if value_missing(value.get(field))
            ]
            if missing_fields:
                missing_traceability.append(
                    {
                        "category": "nested-red-line-raw-source",
                        "failedStep": f"{path}.rawEvidenceSummary",
                        "policyId": value.get("policyId"),
                        "missingFields": missing_fields,
                        "sourceArtifactKind": value.get("rawSourceArtifactKind"),
                        "sourcePhase": value.get("rawSourcePhase"),
                        "reason": "red-line raw evidence summary is missing source traceability",
                    }
                )
        for key, nested_value in value.items():
            missing_traceability.extend(raw_evidence_traceability(nested_value, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, nested_value in enumerate(value):
            missing_traceability.extend(raw_evidence_traceability(nested_value, f"{path}[{index}]"))
    return missing_traceability


def generic_source_traceability(value: Any, path: str = "$") -> list[dict[str, Any]]:
    missing_traceability: list[dict[str, Any]] = []
    if isinstance(value, dict):
        present_source_fields = SOURCE_TRACE_FIELD_SET.intersection(value.keys())
        evidence_source_fields = {
            "sourceArtifactKind",
            "sourcePhase",
            "sourceBom",
            "sourceSpec",
            "sourceGate",
        }
        has_specialized_traceability_check = (
            ("category" in value and "failedStep" in value)
            or path.endswith(".rawEvidence")
            or ".sampleBlockers[" in path
        )
        if path != "$" and present_source_fields.intersection(evidence_source_fields) and not has_specialized_traceability_check:
            missing_fields = [
                field
                for field in REQUIRED_ISSUE_FIELDS
                if value_missing(value.get(field))
            ]
            if missing_fields:
                missing_traceability.append(
                    {
                        "category": "nested-source-summary",
                        "failedStep": path,
                        "missingFields": missing_fields,
                        "sourceArtifactKind": value.get("sourceArtifactKind"),
                        "sourcePhase": value.get("sourcePhase"),
                        "reason": "nested source summary is missing source traceability",
                    }
                )
        for key, nested_value in value.items():
            generic_path = f"{path}.{key}"
            missing_traceability.extend(generic_source_traceability(nested_value, generic_path))
    elif isinstance(value, list):
        for index, nested_value in enumerate(value):
            missing_traceability.extend(generic_source_traceability(nested_value, f"{path}[{index}]"))
    return missing_traceability


def route_trust_consistency(value: Any, path: str = "$") -> list[dict[str, Any]]:
    inconsistencies: list[dict[str, Any]] = []
    if isinstance(value, dict):
        has_route_trust_fields = "routeProofTrusted" in value or "stationTelemetryRouteProofTrusted" in value
        if has_route_trust_fields:
            trusted = value.get("routeProofTrusted")
            if not isinstance(trusted, bool):
                trusted = value.get("stationTelemetryRouteProofTrusted")
            blocked_proofs = value.get("routeTrustBlockedProofs")
            if not isinstance(blocked_proofs, list):
                blocked_proofs = value.get("stationTelemetryRouteTrustBlockedProofs")
            if not isinstance(blocked_proofs, list):
                blocked_proofs = []
            prerequisite_fields = {
                "runtimeClosureProofStatus": "runtime.closure",
                "localSourceDeploymentProofStatus": "local-source.deployable-head",
                "localSourceHeadRouteContractProofStatus": "local-source.head-route-contracts",
                "targetRuntimeIdentityProofStatus": "target-runtime.identity",
                "targetRuntimeRouteContractProofStatus": "target-runtime.route-contracts",
                "stationTelemetryRouteRuntimeClosureProofStatus": "runtime.closure",
                "stationTelemetryRouteLocalSourceDeploymentProofStatus": "local-source.deployable-head",
                "stationTelemetryRouteLocalSourceHeadRouteContractProofStatus": "local-source.head-route-contracts",
                "stationTelemetryRouteTargetRuntimeIdentityProofStatus": "target-runtime.identity",
                "stationTelemetryRouteTargetRuntimeRouteContractProofStatus": "target-runtime.route-contracts",
            }
            unproven_prerequisites = [
                {"field": field, "proofStatus": value.get(field), "expectedBlockerStep": expected_step}
                for field, expected_step in prerequisite_fields.items()
                if field in value and value.get(field) != "PROVEN"
            ]
            blocker_steps = {
                blocker.get("step")
                for blocker in blocked_proofs
                if isinstance(blocker, dict) and isinstance(blocker.get("step"), str)
            }
            missing_blocker_steps = sorted(
                {
                    item["expectedBlockerStep"]
                    for item in unproven_prerequisites
                    if item["expectedBlockerStep"] not in blocker_steps
                }
            )
            if trusted is True and blocked_proofs:
                inconsistencies.append(
                    {
                        "category": "route-trust-consistency",
                        "failedStep": f"{path}.routeProofTrusted",
                        "reason": "routeProofTrusted is true while route trust blocker proofs are present",
                        "routeProofTrusted": trusted,
                        "routeTrustBlockedProofCount": len(blocked_proofs),
                    }
                )
            if trusted is True and unproven_prerequisites:
                inconsistencies.append(
                    {
                        "category": "route-trust-consistency",
                        "failedStep": f"{path}.routeProofTrusted",
                        "reason": "routeProofTrusted is true while one or more route trust prerequisites are not PROVEN",
                        "routeProofTrusted": trusted,
                        "unprovenPrerequisites": unproven_prerequisites,
                    }
                )
            if trusted is False and unproven_prerequisites and not blocked_proofs:
                inconsistencies.append(
                    {
                        "category": "route-trust-consistency",
                        "failedStep": f"{path}.routeProofTrusted",
                        "reason": "routeProofTrusted is false due to unproven prerequisites, but route trust blocker proofs are missing",
                        "routeProofTrusted": trusted,
                        "unprovenPrerequisites": unproven_prerequisites,
                    }
                )
            if trusted is False and missing_blocker_steps:
                inconsistencies.append(
                    {
                        "category": "route-trust-consistency",
                        "failedStep": f"{path}.routeProofTrusted",
                        "reason": "routeProofTrusted is false due to unproven prerequisites, but one or more prerequisite blocker proofs are missing",
                        "routeProofTrusted": trusted,
                        "missingBlockerSteps": missing_blocker_steps,
                        "unprovenPrerequisites": unproven_prerequisites,
                    }
                )
        for key, nested_value in value.items():
            inconsistencies.extend(route_trust_consistency(nested_value, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, nested_value in enumerate(value):
            inconsistencies.extend(route_trust_consistency(nested_value, f"{path}[{index}]"))
    return inconsistencies


def inspect_artifact(path: Path) -> dict[str, Any]:
    artifact = load_json(path)
    if artifact is None:
        return {
            "path": str(path),
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "artifact is missing or is not valid JSON",
            "issueCount": 0,
            "missingResultTraceabilityCount": 0,
            "missingTraceability": [],
            "missingResultTraceability": [],
        }
    issues = artifact.get("issueBreakdown", artifact.get("issue_breakdown", []))
    if not isinstance(issues, list):
        return {
            "path": str(path),
            "artifactKind": artifact.get("artifactKind"),
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "artifact issueBreakdown is missing or invalid",
            "issueCount": 0,
            "missingResultTraceabilityCount": 0,
            "missingTraceability": [],
            "missingResultTraceability": [],
        }
    missing_traceability: list[dict[str, Any]] = []
    for index, issue in enumerate(issues):
        if not isinstance(issue, dict):
            missing_traceability.append(
                {
                    "index": index,
                    "category": "invalid-issue",
                    "missingFields": REQUIRED_ISSUE_FIELDS,
                    "reason": "issue is not an object",
                }
            )
            continue
        missing = issue_values_valid(issue)
        if missing:
            missing_traceability.append(
                {
                    "index": index,
                    "category": issue.get("category"),
                    "failedStep": issue.get("failedStep"),
                    "missingFields": missing,
                    "sourceArtifactKind": issue.get("sourceArtifactKind"),
                    "sourcePhase": issue.get("sourcePhase"),
                }
            )
    missing_result_traceability: list[dict[str, Any]] = []
    nested_missing_traceability: list[dict[str, Any]] = []
    summary = artifact.get("summary")
    if isinstance(summary, dict):
        nested_missing_traceability = route_evidence_source_traceability(summary)
    nested_missing_traceability.extend(sample_blocker_traceability(artifact))
    nested_missing_traceability.extend(raw_evidence_traceability(artifact))
    nested_missing_traceability.extend(generic_source_traceability(artifact))
    nested_missing_traceability.extend(route_trust_consistency(artifact))
    result_traceability_state = artifact.get("resultTraceabilityState")
    if artifact.get("artifactKind") == "acceptance-run" or result_traceability_state is not None:
        if not isinstance(result_traceability_state, dict):
            missing_result_traceability.append(
                {
                    "failedStep": "acceptance-run-result-traceability-state",
                    "missingFields": ["resultTraceabilityState"],
                    "reason": "acceptance-run artifact is missing resultTraceabilityState",
                }
            )
        elif result_traceability_state.get("status") != "pass":
            state_missing = result_traceability_state.get("missingTraceability")
            if isinstance(state_missing, list) and state_missing:
                for missing_item in state_missing:
                    if not isinstance(missing_item, dict):
                        continue
                    missing_result_traceability.append(
                        {
                            "failedStep": "acceptance-run-result-traceability-state",
                            **missing_item,
                        }
                    )
            else:
                missing_result_traceability.append(
                    {
                        "failedStep": "acceptance-run-result-traceability-state",
                        "status": result_traceability_state.get("status"),
                        "reason": result_traceability_state.get(
                            "reason",
                            "acceptance-run result traceability state is not pass",
                        ),
                    }
                )
    all_missing_traceability = missing_traceability + nested_missing_traceability
    status = "pass" if not all_missing_traceability and not missing_result_traceability else "diagnostic incomplete"
    return {
        "path": str(path),
        "artifactKind": artifact.get("artifactKind"),
        "status": status,
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "reason": "all aggregate issues, nested evidence sources, and acceptance-run results preserve source traceability"
        if status == "pass"
        else "one or more aggregate issues, nested evidence sources, or acceptance-run results are missing source traceability",
        "issueCount": len(issues),
        "nestedTraceabilityCount": len(nested_missing_traceability),
        "routeTrustConsistencyCount": len(
            [item for item in nested_missing_traceability if item.get("category") == "route-trust-consistency"]
        ),
        "missingResultTraceabilityCount": len(missing_result_traceability),
        "missingTraceability": all_missing_traceability,
        "missingNestedTraceability": nested_missing_traceability,
        "missingResultTraceability": missing_result_traceability,
    }


def build_report(inputs: list[str]) -> dict[str, Any]:
    artifact_states = [inspect_artifact(Path(path)) for path in inputs]
    missing = [
        {
            "artifactPath": state["path"],
            **missing_item,
        }
        for state in artifact_states
        for missing_item in state.get("missingTraceability", [])
    ]
    missing_results = [
        {
            "artifactPath": state["path"],
            **missing_item,
        }
        for state in artifact_states
        for missing_item in state.get("missingResultTraceability", [])
    ]
    status = "pass" if not missing and all(state.get("status") == "pass" for state in artifact_states) else "diagnostic incomplete"
    report: dict[str, Any] = {
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "inputs": inputs,
        "artifactStates": artifact_states,
        "summary": {
            "artifactCount": len(artifact_states),
            "issueCount": sum(int(state.get("issueCount") or 0) for state in artifact_states),
            "nestedTraceabilityCount": sum(int(state.get("nestedTraceabilityCount") or 0) for state in artifact_states),
          "routeTrustConsistencyCount": sum(int(state.get("routeTrustConsistencyCount") or 0) for state in artifact_states),
            "missingTraceabilityCount": len(missing),
            "missingResultTraceabilityCount": len(missing_results),
            "sampleEmissionAllowed": False,
        },
        "reason": "all Phase 0 aggregate issues, nested evidence sources, and acceptance-run results preserve source traceability"
        if status == "pass"
        else "Phase 0 aggregate issue, nested evidence source, or result source traceability is incomplete",
    }
    if status != "pass":
        report["details"] = missing + missing_results
        issue = {
            "category": "desktop-performance-traceability",
            "failedStep": "aggregate-source-traceability",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "summary": report["reason"],
              "proofImpact": "P0c-5 remains PARTIAL/UNPROVEN until every aggregate issue, nested evidence source, acceptance-run result, and route trust verdict has source artifact, phase, BOM, Spec, Gate binding, and fail-closed consistency.",
            "sourceArtifact": "evidence-store:current:report",
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
            "evidenceDetails": missing,
        }
        report["issue_breakdown"] = [issue]
        report["issueBreakdown"] = [issue]
    return report


def write_report(report: dict[str, Any], output: str) -> Path:
    path = explicit_output_path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.input:
        inputs = args.input
        resolved_refs: dict[Path, dict[str, Any]] = {}
    else:
        inputs, resolved_refs = default_inputs_with_refs()
    report = build_report(inputs)
    if resolved_refs:
        report["inputArtifactRefs"] = list(resolved_refs.values())
    report = replace_resolved_artifact_paths(report, resolved_refs)
    if args.output:
        path = write_report(report, args.output)
        display_output = str(path)
    else:
        with artifact_session(ARTIFACT_KIND) as session:
            session.write_json(DEFAULT_OUTPUT, report, role="report")
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_output = DEFAULT_OUTPUT
    print(f"desktop performance traceability gate: {display_output}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
