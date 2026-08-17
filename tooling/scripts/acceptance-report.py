#!/usr/bin/env python3
"""Render the latest acceptance plan/run as a Markdown report."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def main() -> int:
    from tooling.acceptance.core import (
        RUN_GATE_ENV,
        ArtifactSession,
        EvidenceStore,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--run")
    args = parser.parse_args()

    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    plan = (
        load(Path(args.plan))
        if args.plan
        else store.read_json(store.latest_artifact_ref("acceptance-plan", "plan"))
    )
    run = (
        load(Path(args.run))
        if args.run
        else store.read_json(store.latest_artifact_ref("acceptance-run", "run"))
    )
    lines = [
        "# Acceptance Report",
        "",
        "## Changed Paths",
        "",
    ]
    for path in plan.get("changed_paths", []):
        lines.append(f"- `{path}`")
    if not plan.get("changed_paths"):
        lines.append("- none")

    lines.extend(["", "## Impacted Features", ""])
    for feature in plan.get("impacted_features", []):
        lines.append(f"- `{feature}`")
    if not plan.get("impacted_features"):
        lines.append("- none")

    lines.extend(["", "## Selected Gates", ""])
    for gate in plan.get("selected_gates", []):
        tier = gate.get("tier", "local-evidence")
        environment = gate.get("environment", "local")
        lines.append(f"- `{gate['id']}` [{tier}/{environment}]: `{gate['command']}`")
    if not plan.get("selected_gates"):
        lines.append("- none")

    lines.extend(["", "## Run Results", ""])
    for result in run.get("results", []):
        log = result.get("log")
        suffix = f" log=`{log}`" if log else ""
        tier = result.get("tier", "local-evidence")
        environment = result.get("environment", "local")
        lines.append(f"- `{result['id']}` [{tier}/{environment}]: {result['status']}{suffix}")
    if not run.get("results"):
        lines.append("- not run")

    gate_id = os.environ.get(RUN_GATE_ENV) or "acceptance-report"
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as session:
        reference = session.write_bytes(
            "reports/acceptance-report.md",
            ("\n".join(lines) + "\n").encode("utf-8"),
            media_type="text/markdown",
            role="report",
        )
        session.complete(
            status="passed",
            completion_status=str(run.get("completionStatus") or "PARTIAL"),
            proof_status=str(run.get("proofStatus") or "UNPROVEN"),
        )
    print(f"acceptance report: {json.dumps(reference.to_dict(), sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
