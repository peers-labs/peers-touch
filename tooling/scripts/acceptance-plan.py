#!/usr/bin/env python3
"""Plan acceptance gates from a git diff range."""

from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
from pathlib import Path
from typing import Any


def load_json_yaml(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def changed_paths(diff_range: str) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", diff_range],
        check=True,
        text=True,
        capture_output=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(f"/{path}", pattern)


def plan(root: Path, paths: list[str]) -> dict[str, Any]:
    registry = load_json_yaml(root / "registry.yaml")
    gates = load_json_yaml(root / "gates.yaml").get("gates", {})
    selected: dict[str, dict[str, Any]] = {}
    impacted_features: set[str] = set()
    matched_rules: list[dict[str, Any]] = []

    for rule in registry.get("rules", []):
        patterns = rule.get("when", {}).get("paths", [])
        matched_paths = [path for path in paths if any(matches(path, pattern) for pattern in patterns)]
        if not matched_paths:
            continue
        matched_rules.append({"id": rule.get("id"), "paths": matched_paths})
        impacted_features.update(rule.get("features", []))
        for gate_id in rule.get("require", []):
            if gate_id not in gates:
                raise SystemExit(f"gate {gate_id!r} referenced by rule {rule.get('id')!r} is missing")
            selected.setdefault(
                gate_id,
                {
                    "id": gate_id,
                    "command": gates[gate_id]["command"],
                    "timeout_seconds": gates[gate_id].get("timeout_seconds", 600),
                    "environment": gates[gate_id].get("environment", "local"),
                    "tier": gates[gate_id].get("tier", "local-evidence"),
                    "description": gates[gate_id].get("description", ""),
                    "required_by": [],
                },
            )
            selected[gate_id]["required_by"].append(rule.get("id"))

    return {
        "changed_paths": paths,
        "matched_rules": matched_rules,
        "impacted_features": sorted(impacted_features),
        "selected_gates": list(selected.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--output", default="tooling/acceptance/reports/latest-plan.json")
    parser.add_argument("--range", dest="diff_range", default="HEAD")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--changed-file", action="append", default=[])
    args = parser.parse_args()

    root = Path(args.root)
    paths = args.changed_file or changed_paths(args.diff_range)
    result = plan(root, paths)
    result["range"] = args.diff_range

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("Acceptance Plan")
    print("===============")
    print(f"range: {args.diff_range}")
    print(f"changed_paths: {len(result['changed_paths'])}")
    print(f"impacted_features: {', '.join(result['impacted_features']) or 'none'}")
    if result["selected_gates"]:
        for gate in result["selected_gates"]:
            print(f"[GATE] {gate['id']} [{gate['tier']}/{gate['environment']}]: {gate['command']}")
    else:
        print("[GATE] none")
    print(f"plan: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
