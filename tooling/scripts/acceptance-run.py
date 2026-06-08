#!/usr/bin/env python3
"""Run acceptance gates from the current plan or explicit gate ids."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path
from typing import Any


def load_plan(path: Path) -> dict[str, Any]:
    if not path.exists():
        subprocess.run(["python3", "tooling/scripts/acceptance-plan.py"], check=True)
    return json.loads(path.read_text(encoding="utf-8"))


def load_gate_definitions(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")).get("gates", {})


def gate_from_definition(gate_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": gate_id,
        "command": definition["command"],
        "timeout_seconds": definition.get("timeout_seconds", 600),
        "environment": definition.get("environment", "local"),
        "description": definition.get("description", ""),
        "required_by": ["manual"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", default="tooling/acceptance/reports/latest-plan.json")
    parser.add_argument("--gates", default="tooling/acceptance/gates.yaml")
    parser.add_argument("--output", default="tooling/acceptance/reports/latest-run.json")
    parser.add_argument("--gate", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    plan = load_plan(Path(args.plan))
    gates = plan.get("selected_gates", [])
    if args.gate:
        requested = set(args.gate)
        selected_by_id = {gate["id"]: gate for gate in gates}
        definitions = load_gate_definitions(Path(args.gates))
        gates = []
        for gate_id in args.gate:
            if gate_id in selected_by_id:
                gates.append(selected_by_id[gate_id])
                continue
            if gate_id not in definitions:
                raise SystemExit(f"gate {gate_id!r} is missing from {args.gates}")
            gates.append(gate_from_definition(gate_id, definitions[gate_id]))

    results: list[dict[str, Any]] = []
    print("Acceptance Run")
    print("==============")
    if not gates:
        print("[SKIP] no selected gates")

    for gate in gates:
        gate_id = gate["id"]
        command = gate["command"]
        timeout = int(gate.get("timeout_seconds") or 600)
        print(f"[RUN] {gate_id}: {command}")
        started = time.time()
        if args.dry_run:
            results.append({"id": gate_id, "command": command, "status": "dry-run", "duration_seconds": 0})
            continue
        completed = subprocess.run(
            command,
            shell=True,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        duration = round(time.time() - started, 3)
        status = "passed" if completed.returncode == 0 else "failed"
        log_dir = Path("tooling/acceptance/reports/logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"{gate_id}.log"
        log_path.write_text(completed.stdout + completed.stderr, encoding="utf-8")
        print(f"[{status.upper()}] {gate_id} duration={duration}s log={log_path}")
        results.append(
            {
                "id": gate_id,
                "command": command,
                "status": status,
                "exit_code": completed.returncode,
                "duration_seconds": duration,
                "log": str(log_path),
            }
        )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"plan": args.plan, "results": results}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0 if all(result.get("status") in {"passed", "dry-run"} for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
