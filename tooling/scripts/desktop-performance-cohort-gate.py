#!/usr/bin/env python3
"""Fail-closed P0c3-R2 cohort identity gate."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, explicit_output_path


ARTIFACT_KIND = "desktop-performance-cohort-gate"
PRODUCER_GATE_ID = "desktop-performance-cohort-gate"
MANIFEST_ARTIFACT_KIND = "desktop-performance-cohort-manifest"
OBSERVATIONS_ARTIFACT_KIND = "desktop-performance-cohort-observations"
PHASE = "P0c-3"
PLAN_TASK = "P0c3-R2"
GATE = "All runtime cells must prove one complete and identical cohort, including the actual authenticated actor"
DEFAULT_MANIFEST = "tooling/acceptance/desktop-performance-cohort.json"
DEFAULT_OUTPUT = "tooling/acceptance/reports/desktop-performance-cohort-gate.json"
REQUIRED_RUNTIMES = (
    "tauri-webview-dev",
    "tauri-webview-packaged",
)
REQUIRED_SCENARIOS = (
    "text-input",
    "primary-nav",
    "secondary-tab",
    "overlay",
)
COHORT_FIELDS = (
    "profile",
    "account",
    "station",
    "dataRevision",
    "window",
    "warmupRuns",
    "buildRevision",
    "scenarios",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_json(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    if not path.exists():
        return {}, {"status": "missing", "path": str(path), "reason": "source file is missing"}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {}, {"status": "unreadable", "path": str(path), "reason": str(exc)}
    if not isinstance(value, dict):
        return {}, {"status": "invalid", "path": str(path), "reason": "source root must be an object"}
    return value, {"status": "loaded", "path": str(path)}


def non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value not in {"unknown", "pending"}


def valid_window(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("width"), int)
        and value["width"] > 0
        and isinstance(value.get("height"), int)
        and value["height"] > 0
    )


def issue(category: str, failed_step: str, summary: str, source_artifact: str) -> dict[str, Any]:
    return {
        "category": category,
        "failedStep": failed_step,
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "summary": summary,
        "proofImpact": "P0c3-R2 remains PARTIAL/UNPROVEN and every runtime cell stays blocked.",
        "sourceArtifact": source_artifact,
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceGate": GATE,
    }


def validate_manifest(manifest: dict[str, Any], source_artifact: str) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if manifest.get("artifactKind") != MANIFEST_ARTIFACT_KIND:
        issues.append(issue("cohort-manifest", "manifest.artifactKind", "invalid cohort manifest artifactKind", source_artifact))
    if manifest.get("phase") != PHASE or manifest.get("planTask") != PLAN_TASK:
        issues.append(issue("cohort-manifest", "manifest.plan", "cohort manifest is not bound to P0c3-R2", source_artifact))
    for field in ("cohortId", "profile", "account", "expectedActorId", "station", "dataRevision", "buildRevision"):
        if not non_empty_string(manifest.get(field)):
            issues.append(issue("cohort-manifest", f"manifest.{field}", f"cohort manifest field {field} is missing", source_artifact))
    if not valid_window(manifest.get("window")):
        issues.append(issue("cohort-manifest", "manifest.window", "cohort window must have positive integer width and height", source_artifact))
    if not isinstance(manifest.get("warmupRuns"), int) or manifest["warmupRuns"] < 1:
        issues.append(issue("cohort-manifest", "manifest.warmupRuns", "warmupRuns must be at least 1", source_artifact))
    if (
        not isinstance(manifest.get("postWarmupSamplesPerScenario"), int)
        or manifest["postWarmupSamplesPerScenario"] < 30
    ):
        issues.append(issue("cohort-manifest", "manifest.postWarmupSamplesPerScenario", "post-warmup sample count must be at least 30", source_artifact))
    if tuple(manifest.get("runtimes", ())) != REQUIRED_RUNTIMES:
        issues.append(issue("cohort-manifest", "manifest.runtimes", "cohort manifest must list the canonical runtime order", source_artifact))
    if tuple(manifest.get("scenarios", ())) != REQUIRED_SCENARIOS:
        issues.append(issue("cohort-manifest", "manifest.scenarios", "cohort manifest must list all four canonical scenarios", source_artifact))
    return issues


def comparable_value(field: str, value: Any) -> Any:
    if field == "station" and isinstance(value, str):
        return value.rstrip("/")
    return value


def validate_cell(
    runtime: str,
    observation: Any,
    manifest: dict[str, Any],
    source_artifact: str,
) -> list[dict[str, Any]]:
    if not isinstance(observation, dict):
        return [issue("cohort-runtime", f"cohort.{runtime}", f"cohort observation is missing for {runtime}", source_artifact)]

    issues: list[dict[str, Any]] = []
    if observation.get("runtime") != runtime:
        issues.append(issue("cohort-runtime", f"cohort.{runtime}.runtime", f"runtime observation does not identify {runtime}", source_artifact))
    if observation.get("cohortId") != manifest.get("cohortId"):
        issues.append(issue("cohort-mismatch", f"cohort.{runtime}.cohortId", f"{runtime} cohortId does not match the manifest", source_artifact))
    actual_actor = observation.get("actualActorId")
    if actual_actor != manifest.get("expectedActorId"):
        issues.append(
            issue(
                "cohort-actual-actor",
                f"cohort.{runtime}.actualActorId",
                f"{runtime} actual actor mismatch got={actual_actor!r} want={manifest.get('expectedActorId')!r}",
                source_artifact,
            )
        )
    for field in COHORT_FIELDS:
        observed = comparable_value(field, observation.get(field))
        expected = comparable_value(field, manifest.get(field))
        if observed != expected:
            issues.append(
                issue(
                    "cohort-mismatch",
                    f"cohort.{runtime}.{field}",
                    f"{runtime} cohort field {field} does not match the manifest",
                    source_artifact,
                )
            )
    return issues


def build_report(
    manifest_path: Path,
    observations_path: Path,
    output_path: Path = Path(DEFAULT_OUTPUT),
) -> dict[str, Any]:
    manifest, manifest_source = read_json(manifest_path)
    observations, observations_source = read_json(observations_path)
    issues: list[dict[str, Any]] = []
    if manifest_source["status"] != "loaded":
        issues.append(issue("cohort-manifest", "manifest.load", manifest_source["reason"], str(manifest_path)))
    else:
        issues.extend(validate_manifest(manifest, str(manifest_path)))

    if observations_source["status"] != "loaded":
        issues.append(issue("cohort-observations", "observations.load", observations_source["reason"], str(observations_path)))
        cells: dict[str, Any] = {}
    else:
        if observations.get("artifactKind") != OBSERVATIONS_ARTIFACT_KIND:
            issues.append(issue("cohort-observations", "observations.artifactKind", "invalid cohort observations artifactKind", str(observations_path)))
        cells_value = observations.get("cells")
        cells = cells_value if isinstance(cells_value, dict) else {}
        if not isinstance(cells_value, dict):
            issues.append(issue("cohort-observations", "observations.cells", "cohort observations cells must be an object", str(observations_path)))

    if manifest_source["status"] == "loaded":
        for runtime in REQUIRED_RUNTIMES:
            issues.extend(validate_cell(runtime, cells.get(runtime), manifest, str(observations_path)))

    proven = not issues
    report = {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "pass" if proven else "diagnostic incomplete",
        "completionStatus": "DONE" if proven else "PARTIAL",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "sampleEmissionAllowed": proven,
        "phase": PHASE,
        "planTask": PLAN_TASK,
        "gate": GATE,
        "manifestSource": manifest_source,
        "observationsSource": observations_source,
        "cohortId": manifest.get("cohortId"),
        "manifest": manifest,
        "cells": cells,
        "requiredRuntimes": list(REQUIRED_RUNTIMES),
        "requiredScenarios": list(REQUIRED_SCENARIOS),
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "summary": {
            "status": "pass" if proven else "diagnostic incomplete",
            "proofStatus": "PROVEN" if proven else "UNPROVEN",
            "sampleEmissionAllowed": proven,
            "issueCount": len(issues),
            "observedCellCount": len(cells),
            "requiredCellCount": len(REQUIRED_RUNTIMES),
        },
    }
    if issues:
        report["failedStep"] = issues[0]["failedStep"]
        report["reason"] = issues[0]["summary"]
    return report


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
    parser.add_argument("--observations", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    logical_output = args.output or DEFAULT_OUTPUT
    report = build_report(
        Path(args.manifest),
        Path(args.observations),
        Path(logical_output),
    )
    if args.output:
        output = explicit_output_path(args.output)
        write_report(output, report)
        display_output = str(output)
    else:
        with artifact_session(PRODUCER_GATE_ID) as session:
            session.write_json(DEFAULT_OUTPUT, report, role="report")
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_output = DEFAULT_OUTPUT
    print(f"desktop performance cohort gate: {display_output}")
    print(f"status: {report['status']}")
    return 0 if report["sampleEmissionAllowed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
