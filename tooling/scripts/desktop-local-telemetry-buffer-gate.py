#!/usr/bin/env python3
"""Validate Desktop local telemetry inspector snapshot evidence."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ARTIFACT_KIND = "desktop-local-telemetry-buffer-gate"
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
    "Local Desktop telemetry buffer diagnostics must prove sampler event families and interactionId presence "
    "without replacing Station mirror evidence"
)
REQUIRED_OBSERVATION_FIELDS = [
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
REQUIRED_FAMILIES = {
    "interaction": ["interaction.started"],
    "reactCommit": ["react.commit"],
    "storeUpdate": ["store.update"],
    "overlayLatency": ["contextmenu.intent", "overlay.visible"],
    "invoke": ["invoke.started", "invoke.completed|invoke.failed"],
    "mainThread": ["longtask.detected|layout.shift|paint.timing"],
}
OBSERVATION_SOURCE = "window.__PT_FRONTEND_TELEMETRY__"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_json(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    if not path.exists():
        return {}, {"status": "missing", "reason": f"observation file is missing: {path}"}
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {}, {"status": "unreadable", "reason": f"observation file is unreadable: {exc}"}
    if not isinstance(content, dict):
        return {}, {"status": "invalid", "reason": "observation root must be an object"}
    return content, {"status": "loaded", "reason": "observation file loaded"}


def as_count_map(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for key, count in value.items():
        if isinstance(key, str) and isinstance(count, int):
            result[key] = count
    return result


def option_present(by_kind: dict[str, int], option: str) -> bool:
    return by_kind.get(option, 0) > 0


def token_present(by_kind: dict[str, int], token: str) -> bool:
    return any(option_present(by_kind, option) for option in token.split("|"))


def token_count(by_kind: dict[str, int], token: str) -> int:
    return sum(by_kind.get(option, 0) for option in token.split("|"))


def family_evidence(name: str, required: list[str], by_kind: dict[str, int]) -> dict[str, Any]:
    present: dict[str, int] = {}
    missing: list[str] = []
    for token in required:
        count = token_count(by_kind, token)
        if token_present(by_kind, token):
            present[token] = count
        else:
            missing.append(token)
    passed = not missing
    return {
        "status": "pass" if passed else "diagnostic incomplete",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "requiredKinds": required,
        "presentKinds": present,
        "missingKinds": missing,
        "eventCount": sum(present.values()),
        "reason": "required local event family is present" if passed else "required local event family is missing",
    }


def issue(
    failed_step: str,
    summary: str,
    evidence_details: list[Any],
) -> dict[str, Any]:
    return {
        "category": "local-telemetry-buffer",
        "failedStep": failed_step,
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "summary": summary,
        "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN and sample emission stays disabled.",
        "sourceArtifact": "tooling/acceptance/reports/desktop-local-telemetry-buffer-gate.json",
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "evidenceDetails": evidence_details,
    }


def review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Desktop runtime through the active profile.",
            "command": "make desktop",
        },
        {
            "purpose": "Collect local telemetry buffer observations from the Desktop inspector snapshot.",
            "command": (
                "window.__PT_FRONTEND_TELEMETRY__.clear(); "
                "/* perform primary-nav, secondary-tab, and context-menu interactions */ "
                "copy(JSON.stringify(window.__PT_FRONTEND_TELEMETRY__.snapshot(), null, 2)); "
                "/* write copied JSON to tooling/acceptance/reports/desktop-local-telemetry-buffer-observations.json */"
            ),
        },
        {
            "purpose": "Run the local telemetry buffer gate after observations are collected.",
            "command": (
                "python3 tooling/scripts/desktop-local-telemetry-buffer-gate.py "
                "--observations tooling/acceptance/reports/desktop-local-telemetry-buffer-observations.json"
            ),
        },
        {
            "purpose": "Re-run the full Phase 0 bundle.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def build_report(observation: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    by_kind = as_count_map(observation.get("byKind"))
    with_interaction = as_count_map(observation.get("withInteraction"))
    dropped_by_kind = as_count_map(observation.get("droppedByKind"))
    dropped_with_interaction = as_count_map(observation.get("droppedWithInteraction"))
    event_count = observation.get("eventCount")
    max_events = observation.get("maxEvents")
    dropped_count = observation.get("droppedCount")
    event_count_value = event_count if isinstance(event_count, int) else 0
    dropped_count_value = dropped_count if isinstance(dropped_count, int) else 0
    present_fields = [field for field in REQUIRED_OBSERVATION_FIELDS if field in observation]
    missing_fields = [field for field in REQUIRED_OBSERVATION_FIELDS if field not in observation]
    by_kind_sum = sum(by_kind.values())
    with_interaction_sum = sum(with_interaction.values())
    families = {
        name: family_evidence(name, required, by_kind)
        for name, required in REQUIRED_FAMILIES.items()
    }
    issues: list[dict[str, Any]] = []
    source_passed = source.get("status") == "loaded"
    if not source_passed:
        issues.append(issue("observation-source", source.get("reason", "observation source missing"), [source]))
    if observation.get("source") != OBSERVATION_SOURCE:
        issues.append(
            issue(
                "observation-source-identity",
                "local telemetry observation source is not the shared Desktop telemetry inspector",
                [{"expected": OBSERVATION_SOURCE, "actual": observation.get("source")}],
            )
        )
    if missing_fields:
        issues.append(
            issue(
                "observation-required-fields",
                "local telemetry observation is missing required snapshot fields",
                [
                    {
                        "requiredFields": REQUIRED_OBSERVATION_FIELDS,
                        "presentFields": present_fields,
                        "missingFields": missing_fields,
                    }
                ],
            )
        )
    if event_count != by_kind_sum:
        issues.append(
            issue(
                "observation-consistency",
                "local telemetry eventCount must equal byKind count sum",
                [{"eventCount": event_count, "byKindCountSum": by_kind_sum}],
            )
        )
    if dropped_count != 0:
        issues.append(
            issue(
                "local-buffer-drops",
                "local telemetry buffer dropped events before diagnostics completed",
                [
                    {
                        "eventCount": event_count,
                        "maxEvents": max_events,
                        "droppedCount": dropped_count,
                        "droppedByKind": dropped_by_kind,
                        "droppedWithInteraction": dropped_with_interaction,
                    }
                ],
            )
        )
    if with_interaction_sum <= 0:
        issues.append(
            issue(
                "interaction-correlation",
                "local telemetry buffer has no events with interactionId",
                [{"withInteraction": with_interaction}],
            )
        )
    for name, evidence in families.items():
        if evidence["status"] != "pass":
            issues.append(issue(f"sampler:{name}", evidence["reason"], [evidence]))
    passed = not issues
    family_pass_count = sum(1 for item in families.values() if item["status"] == "pass")
    summary = {
        "status": "pass" if passed else "diagnostic incomplete",
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "completionStatus": "DONE" if passed else "PARTIAL",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "eventCount": event_count,
        "maxEvents": max_events,
        "droppedCount": dropped_count,
        "eventKindCount": len(by_kind),
        "observationSourceStatus": "pass" if source_passed else "diagnostic incomplete",
        "observationSourceProofStatus": "PROVEN" if source_passed else "UNPROVEN",
        "observationExpectedSource": OBSERVATION_SOURCE,
        "observationActualSource": observation.get("source"),
        "requiredObservationFieldsStatus": "pass" if not missing_fields else "diagnostic incomplete",
        "requiredObservationFieldsProofStatus": "PROVEN" if not missing_fields else "UNPROVEN",
        "requiredObservationFields": REQUIRED_OBSERVATION_FIELDS,
        "presentObservationFields": present_fields,
        "missingObservationFields": missing_fields,
        "observationConsistencyStatus": "pass" if event_count == by_kind_sum else "diagnostic incomplete",
        "observationConsistencyProofStatus": "PROVEN" if event_count == by_kind_sum else "UNPROVEN",
        "observationByKindCountSum": by_kind_sum,
        "observationWithInteractionCountSum": with_interaction_sum,
        "retentionWindowStatus": "pass" if dropped_count == 0 else "diagnostic incomplete",
        "retentionWindowProofStatus": "PROVEN" if dropped_count == 0 else "UNPROVEN",
        "retentionWindowMaxEvents": max_events,
        "retentionWindowCapacityProven": dropped_count == 0,
        "retentionWindowDroppedByKindCountSum": sum(dropped_by_kind.values()),
        "retentionWindowDroppedWithInteractionCountSum": sum(dropped_with_interaction.values()),
        "retentionWindowDroppedKindAttributionProven": dropped_count == sum(dropped_by_kind.values()),
        "retentionWindowDroppedInteractionAttributionValid": sum(dropped_with_interaction.values()) <= dropped_count_value,
        "retentionWindowTotalObservedOrDroppedCount": event_count_value + dropped_count_value,
        "retentionWindowDropRatio": 0
        if event_count_value + dropped_count_value == 0
        else round(dropped_count_value / (event_count_value + dropped_count_value), 6),
        "retentionWindowRetainedRatio": 1
        if event_count_value + dropped_count_value == 0
        else round(event_count_value / (event_count_value + dropped_count_value), 6),
        "retentionWindowTailWindowOnly": bool(dropped_count),
        "retentionWindowReason": "local telemetry snapshot is complete" if dropped_count == 0 else "local telemetry snapshot is only the retained tail window because events were dropped",
        "interactionEventKindCount": len(with_interaction),
        "familyCount": len(families),
        "familyPassCount": family_pass_count,
        "familyUnprovenCount": len(families) - family_pass_count,
        "provenFamilies": [name for name, item in families.items() if item["status"] == "pass"],
        "unprovenFamilies": [name for name, item in families.items() if item["status"] != "pass"],
        "failedStep": issues[0]["failedStep"] if issues else None,
        "reason": "local telemetry buffer diagnostics are proven" if passed else issues[0]["summary"],
    }
    return {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "sourceArtifact": "tooling/acceptance/reports/desktop-local-telemetry-buffer-gate.json",
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "status": "pass" if passed else "diagnostic incomplete",
        "completionStatus": "DONE" if passed else "PARTIAL",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "runtime": observation.get("runtime"),
        "url": observation.get("url"),
        "readyState": observation.get("readyState"),
        "eventCount": event_count,
        "maxEvents": max_events,
        "droppedCount": dropped_count,
        "byKind": by_kind,
        "withInteraction": with_interaction,
        "droppedByKind": dropped_by_kind,
        "droppedWithInteraction": dropped_with_interaction,
        "families": families,
        "observationSource": source,
        "summary": summary,
        "reason": summary["reason"],
        "failedStep": summary["failedStep"],
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "recommended_review_commands": review_commands(),
        "recommendedReviewCommands": review_commands(),
    }


def render_markdown(report: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Desktop Local Telemetry Buffer Gate",
            "",
            f"- Status: `{report['status']}`",
            f"- Completion: `{report['completionStatus']}`",
            f"- Proof: `{report['proofStatus']}`",
            f"- Runtime: `{report.get('runtime')}`",
            f"- Event count: `{report.get('eventCount')}`",
            f"- Dropped count: `{report.get('droppedCount')}`",
            f"- Failed step: `{report.get('failedStep')}`",
            f"- Reason: `{report.get('reason')}`",
            "",
            "## Boundary",
            "",
            "- This gate validates the local inspector snapshot only.",
            "- Station mirror evidence remains the product telemetry sink proof.",
            "- Missing families or dropped events remain `PARTIAL/UNPROVEN`.",
        ]
    ) + "\n"


def write_outputs(report: dict[str, Any], output_prefix: Path) -> tuple[Path, Path]:
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--observations",
        default="tooling/acceptance/reports/desktop-local-telemetry-buffer-observations.json",
    )
    parser.add_argument(
        "--output-prefix",
        default="tooling/acceptance/reports/desktop-local-telemetry-buffer-gate",
    )
    args = parser.parse_args()
    observation, source = read_json(Path(args.observations))
    report = build_report(observation, source)
    json_path, md_path = write_outputs(report, Path(args.output_prefix))
    print(f"desktop local telemetry buffer gate JSON: {json_path}")
    print(f"desktop local telemetry buffer gate Markdown: {md_path}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
