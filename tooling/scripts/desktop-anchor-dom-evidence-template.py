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

from _acceptance_artifacts import (
    artifact_session,
    explicit_output_path,
    inspect_command,
)

ARTIFACT_KIND = "desktop-anchor-dom-evidence"
OBSERVATIONS_TEMPLATE_ARTIFACT_KIND = "desktop-anchor-dom-observations-template"
PRODUCER_ID = "desktop-anchor-dom-evidence-template-gate"
EVIDENCE_TEMPLATE_PATH = "reports/desktop-anchor-dom-evidence-template.json"
OBSERVATIONS_TEMPLATE_PATH = "reports/desktop-anchor-dom-observations-template.json"
COLLECT_COMMAND = "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py"


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
            "summary": "Dev and packaged Native DOM automation has not populated runtime anchor observations.",
            "proofImpact": "P0b-1 remains PARTIAL/UNPROVEN until both Native runtime cells prove every required anchor.",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "sourceArtifact": "evidence-store:current:evidence-template",
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
            "purpose": "Collect dev-native and packaged-native DOM anchor observations when runtimes are available.",
            "command": COLLECT_COMMAND,
        },
        {
            "purpose": "Inspect the DOM evidence source artifact diagnostics.",
            "command": inspect_command(PRODUCER_ID, "evidence-template"),
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
        "tauriDev": runtime_template("tauri-webview-dev", inventory.REQUIRED_ANCHORS),
        "tauriPackaged": runtime_template(
            "tauri-webview-packaged",
            inventory.REQUIRED_ANCHORS,
        ),
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "summary": {
            "failedStep": "dom-evidence-template",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "reason": "Dev and packaged Native DOM automation has not populated runtime anchor observations.",
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
    reason = "Observation template only; replace count=0 with live dev-native and packaged-native DOM match counts before collection."
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
        "requiredRuntimes": [
            "tauri-webview-dev",
            "tauri-webview-packaged",
        ],
        "requiredAnchors": required_anchors,
        "tauri-webview-dev": runtime_observation_template(
            "tauri-webview-dev",
            inventory.REQUIRED_ANCHORS,
        ),
        "tauri-webview-packaged": runtime_observation_template(
            "tauri-webview-packaged",
            inventory.REQUIRED_ANCHORS,
        ),
        "recommendedCollectionCommand": (
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py"
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--observations-template-output")
    args = parser.parse_args()

    if bool(args.output) != bool(args.observations_template_output):
        parser.error(
            "--output and --observations-template-output must be supplied together"
        )
    evidence_template = build_template()
    observations_template = build_observations_template()
    if args.output:
        output_path = explicit_output_path(args.output)
        observations_template_path = explicit_output_path(
            args.observations_template_output
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(evidence_template, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        observations_template_path.parent.mkdir(parents=True, exist_ok=True)
        observations_template_path.write_text(
            json.dumps(observations_template, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        evidence_output = str(output_path)
        observations_output = str(observations_template_path)
    else:
        with artifact_session(PRODUCER_ID) as session:
            session.write_json(
                EVIDENCE_TEMPLATE_PATH,
                evidence_template,
                role="evidence-template",
            )
            session.write_json(
                OBSERVATIONS_TEMPLATE_PATH,
                observations_template,
                role="observations-template",
            )
            session.complete(
                status=evidence_template["status"],
                completion_status=evidence_template["completionStatus"],
                proof_status=evidence_template["proofStatus"],
            )
        evidence_output = EVIDENCE_TEMPLATE_PATH
        observations_output = OBSERVATIONS_TEMPLATE_PATH
    print(f"desktop anchor DOM evidence template: {evidence_output}")
    print(f"desktop anchor DOM observations template: {observations_output}")
    print("status: diagnostic incomplete")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
