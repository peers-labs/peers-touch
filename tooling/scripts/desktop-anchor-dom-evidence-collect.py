#!/usr/bin/env python3
"""Normalize browser/Tauri DOM anchor observations into the P0b-1 evidence contract."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ARTIFACT_KIND = "desktop-anchor-dom-evidence"
DEFAULT_OUTPUT = "tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
COLLECT_COMMAND = (
    "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
    "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
    f"--output {DEFAULT_OUTPUT}"
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


def runtime_observations(observations: dict[str, Any], runtime_id: str) -> dict[str, Any]:
    aliases = {
        "browser-gateway": ("browser-gateway", "browser"),
        "tauri-webview-dev": ("tauri-webview-dev", "tauriDev"),
        "tauri-webview-packaged": ("tauri-webview-packaged", "tauriPackaged"),
    }
    for alias in aliases[runtime_id]:
        candidate = observations.get(alias)
        if isinstance(candidate, dict):
            return candidate
    return {}


def anchor_observation(runtime: dict[str, Any], anchor_id: str, selector: str) -> dict[str, Any]:
    anchors = runtime.get("anchors", runtime)
    if not isinstance(anchors, dict):
        return {}
    for key in (anchor_id, selector):
        candidate = anchors.get(key)
        if isinstance(candidate, dict):
            return candidate
    return {}


def observed_count(entry: dict[str, Any]) -> int:
    value = entry.get("count", entry.get("matchCount", 0))
    return value if isinstance(value, int) else 0


def normalize_runtime(runtime_id: str, runtime: dict[str, Any], required_anchors: tuple[Any, ...]) -> dict[str, Any]:
    anchors: dict[str, dict[str, Any]] = {}
    for anchor in required_anchors:
        entry = anchor_observation(runtime, anchor.anchor_id, anchor.selector)
        selector = entry.get("selector", anchor.selector)
        count = observed_count(entry)
        status = "pass" if selector == anchor.selector and count > 0 else "diagnostic incomplete"
        anchors[anchor.anchor_id] = {
            "status": status,
            "selector": selector,
            "count": count,
            "reason": "anchor observed with matching selector"
            if status == "pass"
            else "missing matching runtime DOM observation",
        }
    runtime_status = "pass" if all(anchor["status"] == "pass" for anchor in anchors.values()) else "diagnostic incomplete"
    return {
        "runtime": runtime_id,
        "status": runtime_status,
        "proofStatus": "PROVEN" if runtime_status == "pass" else "UNPROVEN",
        "anchors": anchors,
    }


def issue_breakdown(runtimes: tuple[dict[str, Any], ...], source_artifact: str) -> list[dict[str, Any]]:
    inventory = load_inventory_module()
    issues: list[dict[str, Any]] = []
    for runtime in runtimes:
        if runtime["status"] == "pass":
            continue
        missing = [
            anchor_id
            for anchor_id, anchor in runtime["anchors"].items()
            if anchor.get("status") != "pass"
        ]
        issues.append(
            {
                "category": "dom-automation-evidence",
                "failedStep": runtime["runtime"],
                "status": "diagnostic incomplete",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "summary": f"{runtime['runtime']} missing DOM anchor observations: {','.join(missing)}",
                "proofImpact": "P0b-1 remains PARTIAL/UNPROVEN until browser, dev native, and packaged native DOM evidence proves every required anchor.",
                "sourceArtifact": source_artifact,
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": inventory.DOM_EVIDENCE_PHASE,
                "sourceBom": list(inventory.DOM_EVIDENCE_BOM),
                "sourceSpec": list(inventory.DOM_EVIDENCE_SPEC),
                "sourceGate": inventory.DOM_EVIDENCE_GATE,
            }
        )
    return issues


def recommended_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
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


def build_evidence(observations: dict[str, Any], source_artifact: str = DEFAULT_OUTPUT) -> dict[str, Any]:
    inventory = load_inventory_module()
    browser = normalize_runtime(
        "browser-gateway",
        runtime_observations(observations, "browser-gateway"),
        inventory.REQUIRED_ANCHORS,
    )
    tauri_dev = normalize_runtime(
        "tauri-webview-dev",
        runtime_observations(observations, "tauri-webview-dev"),
        inventory.REQUIRED_ANCHORS,
    )
    tauri_packaged = normalize_runtime(
        "tauri-webview-packaged",
        runtime_observations(observations, "tauri-webview-packaged"),
        inventory.REQUIRED_ANCHORS,
    )
    runtimes = (browser, tauri_dev, tauri_packaged)
    proven = all(runtime["status"] == "pass" for runtime in runtimes)
    evidence = {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "source": "dom-observations",
        "status": "pass" if proven else "diagnostic incomplete",
        "completionStatus": "DONE" if proven else "PARTIAL",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "sampleEmissionAllowed": proven,
        "phase": inventory.DOM_EVIDENCE_PHASE,
        "bom": list(inventory.DOM_EVIDENCE_BOM),
        "spec": list(inventory.DOM_EVIDENCE_SPEC),
        "gate": inventory.DOM_EVIDENCE_GATE,
        "browser": browser,
        "tauriDev": tauri_dev,
        "tauriPackaged": tauri_packaged,
    }
    if not proven:
        issues = issue_breakdown(runtimes, source_artifact)
        review_commands = recommended_review_commands()
        evidence["issue_breakdown"] = issues
        evidence["issueBreakdown"] = issues
        evidence["summary"] = {
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "failedStep": ",".join(issue["failedStep"] for issue in issues),
            "reason": "; ".join(issue["summary"] for issue in issues),
        }
        evidence["recommended_review_commands"] = review_commands
        evidence["recommendedReviewCommands"] = review_commands
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observations", required=True)
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
    )
    args = parser.parse_args()

    observations_path = Path(args.observations)
    output_path = Path(args.output)
    observations = json.loads(observations_path.read_text(encoding="utf-8"))
    evidence = build_evidence(observations, args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"desktop anchor DOM evidence: {output_path}")
    print(f"status: {evidence['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
