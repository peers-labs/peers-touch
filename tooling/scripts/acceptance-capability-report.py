#!/usr/bin/env python3
"""Render a product capability report from acceptance contracts and run results."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def load_feature(root: Path, feature_id: str) -> dict[str, Any]:
    path = root / "features" / f"{feature_id}.yaml"
    if not path.exists():
        raise SystemExit(f"feature contract {feature_id!r} is missing: {path}")
    return load_json(path)


def bullet(lines: list[str], value: str) -> None:
    lines.append(f"- {value}")


def render_feature(lines: list[str], feature: dict[str, Any]) -> None:
    feature_id = feature.get("id", "unknown")
    bullet(lines, f"`{feature_id}` status={feature.get('status', 'unknown')} area={feature.get('product_area', 'unknown')}")

    truth_sources = feature.get("truth_sources", [])
    if truth_sources:
        bullet(lines, f"`{feature_id}` truth sources: " + ", ".join(f"`{source}`" for source in truth_sources))

    required_gates = feature.get("required_gates", [])
    if required_gates:
        bullet(lines, f"`{feature_id}` required gates: " + ", ".join(f"`{gate}`" for gate in required_gates))


def render_results(lines: list[str], run: dict[str, Any]) -> bool:
    results = run.get("results", [])
    if not results:
        bullet(lines, "No gate results were found; product capability is not proven.")
        return False

    all_passed = True
    for result in results:
        status = result.get("status", "unknown")
        all_passed = all_passed and status in {"passed", "dry-run"}
        log = result.get("log")
        suffix = f" log=`{log}`" if log else ""
        bullet(lines, f"`{result.get('id', 'unknown')}`: {status}{suffix}")
    return all_passed


def render_mutual_validation(lines: list[str], data: dict[str, Any]) -> bool:
    capabilities = data.get("capabilities", [])
    if not capabilities:
        bullet(lines, "No mutual-validation capability evidence was found.")
        return False

    all_proven = True
    for capability in capabilities:
        status = capability.get("status", "unknown")
        all_proven = all_proven and status == "proven"
        bullet(lines, f"`{capability.get('id', 'unknown')}`: {status}")
        missing = capability.get("missing_run_gates", [])
        if missing:
            bullet(lines, f"`{capability.get('id', 'unknown')}` missing run gates: " + ", ".join(f"`{gate}`" for gate in missing))
        for item in capability.get("unproven_scope", []):
            bullet(lines, f"`{capability.get('id', 'unknown')}` unproven: {item}")
    return all_proven


def main() -> int:
    from tooling.acceptance.core import (
        RUN_GATE_ENV,
        ArtifactSession,
        EvidenceStore,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--run")
    parser.add_argument("--title", default="Acceptance Capability Report")
    parser.add_argument("--feature", action="append", required=True)
    parser.add_argument("--mutual-validation-gate", default="")
    args = parser.parse_args()

    root = REPO_ROOT / args.root
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    run = (
        load_json(Path(args.run))
        if args.run
        else store.read_json(store.latest_artifact_ref("acceptance-run", "run"))
    )
    features = [load_feature(root, feature_id) for feature_id in args.feature]

    lines = [
        f"# {args.title}",
        "",
        "## Scope",
        "",
    ]
    for feature in features:
        render_feature(lines, feature)

    lines.extend(["", "## Gate Results", ""])
    all_passed = render_results(lines, run)

    mutual_passed = True
    if args.mutual_validation_gate:
        lines.extend(["", "## Mutual Validation", ""])
        mutual = store.read_json(
            store.latest_artifact_ref(
                args.mutual_validation_gate,
                "validation",
            )
        )
        mutual_passed = render_mutual_validation(lines, mutual)

    lines.extend(
        [
            "",
            "## Feasibility Conclusion",
            "",
        ]
    )
    if all_passed and mutual_passed:
        bullet(lines, "Acceptance is executable for the selected product capability because every selected gate completed successfully.")
        bullet(lines, "Federation is suitable as the first validation domain because it spans Station, Dashboard, Desktop gateway, projections, and testnet services.")
        bullet(lines, "The acceptance framework is useful when capability graph, feature contracts, registry rules, gates, and reports are updated together.")
    else:
        bullet(lines, "Acceptance feasibility is not proven because one or more selected gates or mutual-validation capabilities did not pass.")
        bullet(lines, "Do not mark the product capability done until failed gates are fixed or explicitly scoped as unproven risk.")

    lines.extend(["", "## Unproven Scope", ""])
    if args.mutual_validation_gate:
        bullet(lines, "See the Mutual Validation section for domain-specific unproven scope.")
    else:
        bullet(lines, "No mutual-validation evidence was provided, so capability-level unproven scope is not expanded in this report.")
    bullet(lines, "Project-wide coverage requires each product domain to register its own acceptance domain profile and stable gates.")

    gate_id = os.environ.get(RUN_GATE_ENV) or "acceptance-capability-report"
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as session:
        reference = session.write_bytes(
            "reports/capability-report.md",
            ("\n".join(lines) + "\n").encode("utf-8"),
            media_type="text/markdown",
            role="capability-report",
        )
        passed = all_passed and mutual_passed
        session.complete(
            status="passed" if passed else "failed",
            completion_status="DONE" if passed else "PARTIAL",
            proof_status="PROVEN" if passed else "UNPROVEN",
        )
    print(
        "acceptance capability report: "
        + json.dumps(reference.to_dict(), sort_keys=True)
    )
    return 0 if all_passed and mutual_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
