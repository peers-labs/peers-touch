#!/usr/bin/env python3
"""Normalize P0c-3 runtime-cell observations into matrix cell evidence."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, inspect_command


PRODUCER_GATE_ID = "desktop-performance-cell-collect-gate"
DEFAULT_OUTPUT_DIR = "reports/desktop-performance-cells"


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


def cell_specs(matrix: Any) -> dict[str, Any]:
    return {
        spec.cell_id: spec
        for spec in matrix.DEFAULT_CELLS
        if spec.cell_id != "browser-gateway"
    }


def runtime_cell_issue_breakdown(matrix: Any, spec: Any, reason: str, source_artifact: str) -> list[dict[str, Any]]:
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
            "sourceArtifact": source_artifact,
            "sourceArtifactKind": matrix.CELL_REQUIRED_ARTIFACT_KIND,
            "sourcePhase": matrix.CELL_REQUIRED_PHASE,
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


def read_observations(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    if not path.exists():
        return {}, {
            "status": "missing",
            "path": str(path),
            "reason": "runtime cell observations file is missing",
        }
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {}, {
            "status": "unreadable",
            "path": str(path),
            "reason": "runtime cell observations file is unreadable",
            "error": str(exc),
        }
    if not isinstance(content, dict):
        return {}, {
            "status": "invalid",
            "path": str(path),
            "reason": "runtime cell observations root must be an object",
        }
    return content, {"status": "loaded", "path": str(path)}


def observation_for_cell(observations: dict[str, Any], cell_id: str) -> dict[str, Any]:
    cells = observations.get("cells")
    if isinstance(cells, dict) and isinstance(cells.get(cell_id), dict):
        return cells[cell_id]
    candidate = observations.get(cell_id)
    if isinstance(candidate, dict):
        return candidate
    if observations.get("cellId") == cell_id:
        return observations
    return {}


def normalize_ready_shell(observation: dict[str, Any]) -> dict[str, Any]:
    ready_shell = observation.get("readyShell")
    if not isinstance(ready_shell, dict):
        return {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "ready shell observation is missing",
        }
    visible = ready_shell.get("visible")
    status = ready_shell.get("status")
    proven = status == "pass" and visible is True
    return {
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "visible": visible,
        "observedStatus": status,
        "reason": "ready shell is visible in this runtime cell"
        if proven
        else "ready shell observation must have status=pass and visible=true",
    }


def telemetry_events(observation: dict[str, Any]) -> list[dict[str, Any]]:
    events = observation.get("events")
    if not isinstance(events, list):
        telemetry = observation.get("telemetry")
        if isinstance(telemetry, dict):
            events = telemetry.get("events")
    if not isinstance(events, list):
        return []
    return [event for event in events if isinstance(event, dict)]


def normalize_telemetry(observation: dict[str, Any]) -> dict[str, Any]:
    events = telemetry_events(observation)
    interaction_ids = sorted(
        {
            str(event.get("interactionId"))
            for event in events
            if event.get("interactionId")
        }
    )
    proven = bool(events) and bool(interaction_ids)
    return {
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "eventCount": len(events),
        "interactionIds": interaction_ids,
        "eventKinds": sorted(
            {
                str(event.get("kind"))
                for event in events
                if event.get("kind")
            }
        ),
        "reason": "telemetry events include at least one interactionId"
        if proven
        else "runtime cell telemetry event with interactionId is missing",
    }


def build_cell_evidence(
    matrix: Any,
    spec: Any,
    observations: dict[str, Any],
    observation_source: dict[str, Any],
) -> dict[str, Any]:
    observation = observation_for_cell(observations, spec.cell_id)
    validation_details: list[str] = []
    if not observation:
        validation_details.append("missing runtime cell observation")

    observed_runtime = observation.get("runtime")
    observed_entrypoint = observation.get("entrypoint")
    observed_startup_mode = observation.get("startupMode")
    if observed_runtime != spec.runtime:
        validation_details.append("runtime observation does not match matrix cell")
    if observed_entrypoint != spec.entrypoint:
        validation_details.append("entrypoint observation does not match matrix cell")
    if observed_startup_mode != spec.startup_mode:
        validation_details.append("startupMode observation does not match matrix cell")

    ready_shell = normalize_ready_shell(observation)
    telemetry = normalize_telemetry(observation)
    if ready_shell["status"] != "pass":
        validation_details.append("ready shell evidence is not proven")
    if telemetry["status"] != "pass":
        validation_details.append("telemetry sample evidence is not proven")

    source_loaded = observation_source.get("status") == "loaded"
    proven = source_loaded and not validation_details
    interaction_ids = telemetry.get("interactionIds", [])
    reason = (
        "runtime cell observation is sampled and source-bound"
        if proven
        else "runtime cell observation is incomplete; sample emission remains blocked"
    )
    evidence = {
        "schemaVersion": 1,
        "artifactKind": matrix.CELL_REQUIRED_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "source": "runtime-cell-observations",
        "observationSource": observation_source,
        "status": "sampled" if proven else "diagnostic incomplete",
        "completionStatus": "DONE" if proven else "PARTIAL",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "phase": matrix.CELL_REQUIRED_PHASE,
        "bom": list(spec.bom),
        "spec": list(spec.spec),
        "gate": spec.gate,
        "cellId": spec.cell_id,
        "runtime": spec.runtime,
        "entrypoint": spec.entrypoint,
        "startupMode": spec.startup_mode,
        "sampleEmissionAllowed": proven,
        "interactionId": interaction_ids[0] if proven and interaction_ids else None,
        "readyShell": ready_shell,
        "telemetry": telemetry,
        "observedRuntime": observed_runtime,
        "observedEntrypoint": observed_entrypoint,
        "observedStartupMode": observed_startup_mode,
        "validationDetails": validation_details,
        "reason": reason,
    }
    if not proven:
        source_artifact = f"evidence-store:current:cell-{spec.cell_id}"
        issue_breakdown = runtime_cell_issue_breakdown(matrix, spec, reason, source_artifact)
        review_commands = runtime_cell_review_commands(spec)
        evidence["issue_breakdown"] = issue_breakdown
        evidence["issueBreakdown"] = issue_breakdown
        evidence["recommended_review_commands"] = review_commands
        evidence["recommendedReviewCommands"] = review_commands
    return evidence


def build_evidence(
    observations: dict[str, Any],
    observation_source: dict[str, Any] | None = None,
    requested_cell_ids: list[str] | None = None,
) -> dict[str, dict[str, Any]]:
    matrix = load_matrix_module()
    specs = cell_specs(matrix)
    selected = requested_cell_ids or sorted(specs)
    unknown = [cell_id for cell_id in selected if cell_id not in specs]
    if unknown:
        raise ValueError(f"unknown runtime cell id(s): {', '.join(unknown)}")
    source = observation_source or {"status": "loaded", "path": "inline"}
    return {
        cell_id: build_cell_evidence(matrix, specs[cell_id], observations, source)
        for cell_id in selected
    }


def write_evidence(evidence_by_cell: dict[str, dict[str, Any]], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for cell_id, evidence in evidence_by_cell.items():
        path = output_dir / f"{cell_id}.json"
        path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--observations",
        required=True,
        help="Explicit runtime-cell sampler observations path.",
    )
    parser.add_argument(
        "--output-dir",
        help="Explicit output directory. Defaults to a new Evidence Store run.",
    )
    parser.add_argument(
        "--cell-id",
        action="append",
        dest="cell_ids",
        help="Runtime cell id to normalize. Defaults to all non-browser matrix cells.",
    )
    parser.add_argument(
        "--strict-exit",
        action="store_true",
        help="Return non-zero when any runtime cell evidence remains PARTIAL/UNPROVEN.",
    )
    args = parser.parse_args()

    observations_path = Path(args.observations)
    observations, source = read_observations(observations_path)
    evidence_by_cell = build_evidence(observations, source, args.cell_ids)
    statuses = sorted({evidence["status"] for evidence in evidence_by_cell.values()})
    if args.output_dir:
        written = write_evidence(evidence_by_cell, Path(args.output_dir))
        display_outputs = [str(path) for path in written]
    else:
        with artifact_session(PRODUCER_GATE_ID) as session:
            display_outputs = []
            for cell_id, evidence in evidence_by_cell.items():
                relative_path = f"{DEFAULT_OUTPUT_DIR}/{cell_id}.json"
                session.write_json(relative_path, evidence, role=f"cell-{cell_id}")
                display_outputs.append(relative_path)
            proven = all(
                evidence.get("sampleEmissionAllowed") is True
                for evidence in evidence_by_cell.values()
            )
            session.complete(
                status="sampled" if proven else "diagnostic incomplete",
                completion_status="DONE" if proven else "PARTIAL",
                proof_status="PROVEN" if proven else "UNPROVEN",
            )
    for output in display_outputs:
        print(f"desktop performance cell evidence: {output}")
    print(f"status: {','.join(statuses)}")
    if args.strict_exit and any(evidence.get("sampleEmissionAllowed") is not True for evidence in evidence_by_cell.values()):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
