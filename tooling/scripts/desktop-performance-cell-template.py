#!/usr/bin/env python3
"""Generate fail-closed P0c-3 runtime-cell evidence templates."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, explicit_output_path, inspect_command

OBSERVATIONS_TEMPLATE_ARTIFACT_KIND = "desktop-performance-cell-observations-template"
PRODUCER_GATE_ID = "desktop-performance-cell-template-gate"
DEFAULT_OUTPUT_DIR = "reports/desktop-performance-cells"
DEFAULT_OBSERVATIONS_TEMPLATE_OUTPUT = "reports/desktop-performance-cell-observations-template.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_matrix_module():
    script = Path(__file__).with_name("desktop-performance-matrix-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_matrix_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def runtime_cell_issue_breakdown(spec: Any, reason: str) -> list[dict[str, Any]]:
    return [
        {
            "category": "runtime-cell-evidence",
            "failedStep": spec.cell_id,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "summary": reason,
            "proofImpact": "P0c-3 remains PARTIAL/UNPROVEN until this runtime cell emits proven evidence.",
            "sourceArtifactKind": "desktop-performance-runtime-cell",
            "sourcePhase": "P0c-3",
            "sourceBom": list(spec.bom),
            "sourceSpec": list(spec.spec),
            "sourceGate": spec.gate,
        }
    ]


def runtime_cell_review_commands(spec: Any) -> list[dict[str, str]]:
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
            "command": inspect_command(PRODUCER_GATE_ID, f"cell-{spec.cell_id}"),
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


def build_cell_template(matrix: Any, spec: Any) -> dict[str, Any]:
    reason = "runtime cell sampler has not populated evidence"
    issue_breakdown = runtime_cell_issue_breakdown(spec, reason)
    review_commands = runtime_cell_review_commands(spec)
    return {
        "schemaVersion": 1,
        "artifactKind": matrix.CELL_REQUIRED_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "phase": matrix.CELL_REQUIRED_PHASE,
        "bom": list(spec.bom),
        "spec": list(spec.spec),
        "gate": spec.gate,
        "cellId": spec.cell_id,
        "runtime": spec.runtime,
        "entrypoint": spec.entrypoint,
        "startupMode": spec.startup_mode,
        "sampleEmissionAllowed": False,
        "reason": reason,
        "summary": {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": reason,
        },
        "issue_breakdown": issue_breakdown,
        "issueBreakdown": issue_breakdown,
        "recommended_review_commands": review_commands,
        "recommendedReviewCommands": review_commands,
        "readyShell": {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "ready shell runtime evidence has not been collected",
        },
    }


def runtime_cell_observation_template(spec: Any) -> dict[str, Any]:
    matrix = load_matrix_module()
    required_event_kinds = sorted(
        {
            kind
            for policy in matrix.RED_LINE_POLICIES
            for kind in policy.required_event_kinds
        }
    )
    return {
        "cellId": spec.cell_id,
        "runtime": spec.runtime,
        "entrypoint": spec.entrypoint,
        "startupMode": spec.startup_mode,
        "requiredEventKinds": required_event_kinds,
        "readyShell": {
            "status": "diagnostic incomplete",
            "visible": False,
        },
        "events": [
            {
                "kind": "interaction.started",
                "interactionId": "",
                "durationMs": 0,
            }
        ],
    }


def build_observations_template() -> dict[str, Any]:
    matrix = load_matrix_module()
    cells = {
        spec.cell_id: runtime_cell_observation_template(spec)
        for spec in matrix.DEFAULT_CELLS
        if spec.cell_id != "browser-gateway"
    }
    reason = "Observation template only; replace placeholders with live runtime-cell readyShell and telemetry events before collection."
    return {
        "schemaVersion": 1,
        "artifactKind": OBSERVATIONS_TEMPLATE_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": matrix.CELL_REQUIRED_PHASE,
        "bom": ["BOM-GATE-02", "BOM-CAP-04"],
        "spec": ["SPEC-GATE-02", "SPEC-RUN-01"],
        "gate": "Every runtime matrix cell must report explicit state before red-line proof",
        "source": "runtime-cell-observations-template",
        "requiredCells": list(cells),
        "cells": cells,
        "recommendedCollectionCommand": (
            "python3 tooling/scripts/desktop-performance-cell-collect.py "
            "--observations <runtime-cell-observations.json>"
        ),
        "summary": {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": reason,
        },
        "reason": reason,
    }


def build_templates() -> dict[str, dict[str, Any]]:
    matrix = load_matrix_module()
    return {
        spec.cell_id: build_cell_template(matrix, spec)
        for spec in matrix.DEFAULT_CELLS
        if spec.cell_id != "browser-gateway"
    }


def write_templates(output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for cell_id, template in build_templates().items():
        path = output_dir / f"{cell_id}.json"
        path.write_text(json.dumps(template, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        help="Explicit output directory. Defaults to a new Evidence Store run.",
    )
    parser.add_argument(
        "--observations-template-output",
        help="Explicit observations-template output path. Required with --output-dir.",
    )
    parser.add_argument(
        "--strict-exit",
        action="store_true",
        help="Return non-zero when generated templates remain PARTIAL/UNPROVEN.",
    )
    args = parser.parse_args()

    if bool(args.output_dir) != bool(args.observations_template_output):
        parser.error("--output-dir and --observations-template-output must be provided together")
    templates = build_templates()
    observations_template = build_observations_template()
    if args.output_dir:
        written = write_templates(explicit_output_path(args.output_dir))
        observations_template_path = explicit_output_path(args.observations_template_output)
        observations_template_path.parent.mkdir(parents=True, exist_ok=True)
        observations_template_path.write_text(
            json.dumps(observations_template, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        display_templates = [str(path) for path in written]
        display_observations = str(observations_template_path)
    else:
        with artifact_session(PRODUCER_GATE_ID) as session:
            display_templates = []
            for cell_id, template in templates.items():
                relative_path = f"{DEFAULT_OUTPUT_DIR}/{cell_id}.json"
                session.write_json(relative_path, template, role=f"cell-{cell_id}")
                display_templates.append(relative_path)
            session.write_json(
                DEFAULT_OBSERVATIONS_TEMPLATE_OUTPUT,
                observations_template,
                role="observations-template",
            )
            session.complete(
                status="diagnostic incomplete",
                completion_status="PARTIAL",
                proof_status="UNPROVEN",
            )
        display_observations = DEFAULT_OBSERVATIONS_TEMPLATE_OUTPUT
    for output in display_templates:
        print(f"desktop performance cell template: {output}")
    print(f"desktop performance cell observations template: {display_observations}")
    print("status: diagnostic incomplete")
    return 1 if args.strict_exit else 0


if __name__ == "__main__":
    raise SystemExit(main())
