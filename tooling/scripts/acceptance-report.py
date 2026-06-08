#!/usr/bin/env python3
"""Render the latest acceptance plan/run as a Markdown report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", default="tooling/acceptance/reports/latest-plan.json")
    parser.add_argument("--run", default="tooling/acceptance/reports/latest-run.json")
    parser.add_argument("--output", default="tooling/acceptance/reports/latest-report.md")
    args = parser.parse_args()

    plan = load(Path(args.plan))
    run = load(Path(args.run))
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

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"acceptance report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
