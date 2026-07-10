#!/usr/bin/env python3
"""Generate fail-closed Desktop anchor DOM evidence templates for P0b-1."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ARTIFACT_KIND = "desktop-anchor-dom-evidence"
OBSERVATIONS_TEMPLATE_ARTIFACT_KIND = "desktop-anchor-dom-observations-template"
DEFAULT_OUTPUT = Path("tooling/acceptance/reports/desktop-anchor-dom-evidence.json")
DEFAULT_OBSERVATIONS_TEMPLATE_OUTPUT = Path("tooling/acceptance/reports/desktop-anchor-dom-observations-template.json")
COLLECT_COMMAND = (
    "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
    "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
    "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
)


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


def runtime_template(runtime_id: str, anchors: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "runtime": runtime_id,
        "status": "diagnostic incomplete",
        "proofStatus": "UNPROVEN",
        "reason": "DOM automation has not populated runtime anchor observations",
        "anchors": {
            anchor.anchor_id: {
                "status": "diagnostic incomplete",
                "selector": anchor.selector,
                "count": 0,
                "reason": "missing runtime DOM match count",
            }
            for anchor in anchors
        },
    }


def issue_breakdown() -> list[dict[str, Any]]:
    inventory = load_inventory_module()
    return [
        {
            "category": "dom-automation-evidence",
            "failedStep": "dom-evidence-template",
            "summary": "Browser and Tauri/WebView DOM automation has not populated runtime anchor observations.",
            "proofImpact": "P0b-1 remains PARTIAL/UNPROVEN until browser and Tauri/WebView DOM evidence proves every required anchor.",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "sourceArtifact": "tooling/acceptance/reports/desktop-anchor-dom-evidence.json",
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": inventory.DOM_EVIDENCE_PHASE,
            "sourceBom": list(inventory.DOM_EVIDENCE_BOM),
            "sourceSpec": list(inventory.DOM_EVIDENCE_SPEC),
            "sourceGate": inventory.DOM_EVIDENCE_GATE,
        }
    ]


def recommended_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Generate the fail-closed DOM evidence template if runtime automation is unavailable.",
            "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-template.py",
        },
        {
            "purpose": "Collect browser/Tauri DOM anchor observations when runtimes are available.",
            "command": COLLECT_COMMAND,
        },
        {
            "purpose": "Inspect the DOM evidence source artifact diagnostics.",
            "command": "jq '{status,proofStatus,issue_breakdown,recommended_review_commands}' tooling/acceptance/reports/desktop-anchor-dom-evidence.json",
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


def build_template() -> dict[str, Any]:
    inventory = load_inventory_module()
    issues = issue_breakdown()
    review_commands = recommended_review_commands()
    return {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": inventory.DOM_EVIDENCE_PHASE,
        "bom": list(inventory.DOM_EVIDENCE_BOM),
        "spec": list(inventory.DOM_EVIDENCE_SPEC),
        "gate": inventory.DOM_EVIDENCE_GATE,
        "browser": runtime_template("browser-gateway", inventory.REQUIRED_ANCHORS),
        "tauri": runtime_template("tauri-webview", inventory.REQUIRED_ANCHORS),
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "summary": {
            "failedStep": "dom-evidence-template",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": "Browser and Tauri/WebView DOM automation has not populated runtime anchor observations.",
        },
        "recommended_review_commands": review_commands,
        "recommendedReviewCommands": review_commands,
    }


def runtime_observation_template(runtime_id: str, anchors: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "runtime": runtime_id,
        "url": "",
        "title": "",
        "readyState": "",
        "pageState": "",
        "bodyTextPrefix": "",
        "consoleMessagesSummary": "",
        "networkRequestsSummary": {"total": 0},
        "networkLogPath": "",
        "loginSubmitObserved": False,
        "loadingObservedDuringSubmit": False,
        "gatewayResourceCount": 0,
        "gatewayResourceSamples": [],
        "anchors": {
            anchor.anchor_id: {
                "selector": anchor.selector,
                "count": 0,
            }
            for anchor in anchors
        },
    }


def build_observations_template() -> dict[str, Any]:
    inventory = load_inventory_module()
    required_anchors = [
        {
            "anchorId": anchor.anchor_id,
            "selector": anchor.selector,
        }
        for anchor in inventory.REQUIRED_ANCHORS
    ]
    reason = "Observation template only; replace count=0 with live browser/Tauri DOM match counts before collection."
    return {
        "schemaVersion": 1,
        "artifactKind": OBSERVATIONS_TEMPLATE_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": inventory.DOM_EVIDENCE_PHASE,
        "bom": list(inventory.DOM_EVIDENCE_BOM),
        "spec": list(inventory.DOM_EVIDENCE_SPEC),
        "gate": inventory.DOM_EVIDENCE_GATE,
        "source": "dom-observations-template",
        "requiredRuntimes": ["browser-gateway", "tauri-webview"],
        "requiredAnchors": required_anchors,
        "browser-gateway": runtime_observation_template("browser-gateway", inventory.REQUIRED_ANCHORS),
        "tauri-webview": runtime_observation_template("tauri-webview", inventory.REQUIRED_ANCHORS),
        "recommendedCollectionCommand": (
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
            "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
            "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
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


def preserves_collected_evidence(output_path: Path) -> bool:
    if not output_path.exists():
        return False
    try:
        existing = json.loads(output_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return existing.get("artifactKind") == ARTIFACT_KIND and existing.get("source") != "dom-evidence-template"


def normalize_command_text(command: str) -> str:
    collect = "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py"
    observations = "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json"
    output = "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
    if command == collect:
        return COLLECT_COMMAND
    if command.startswith(collect) and observations in command and output not in command:
        return f"{command} {output}"
    return command


def normalize_preserved_evidence_commands(output_path: Path) -> None:
    existing = json.loads(output_path.read_text(encoding="utf-8"))
    changed = False
    for key in ("recommended_review_commands", "recommendedReviewCommands"):
        commands = existing.get(key)
        if not isinstance(commands, list):
            continue
        for command in commands:
            if not isinstance(command, dict) or not isinstance(command.get("command"), str):
                continue
            normalized = normalize_command_text(command["command"])
            if normalized != command["command"]:
                command["command"] = normalized
                changed = True
    if changed:
        output_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
    )
    parser.add_argument(
        "--observations-template-output",
        default=str(DEFAULT_OBSERVATIONS_TEMPLATE_OUTPUT),
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    observations_template_path = Path(args.observations_template_output)
    observations_template_path.parent.mkdir(parents=True, exist_ok=True)
    observations_template_path.write_text(
        json.dumps(build_observations_template(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if preserves_collected_evidence(output_path):
        normalize_preserved_evidence_commands(output_path)
        print(f"desktop anchor DOM evidence preserved: {output_path}")
    else:
        output_path.write_text(json.dumps(build_template(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"desktop anchor DOM evidence template: {output_path}")
    print(f"desktop anchor DOM observations template: {observations_template_path}")
    print("status: diagnostic incomplete")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
