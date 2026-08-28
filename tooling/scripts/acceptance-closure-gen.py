#!/usr/bin/env python3
"""Generate an acceptance plan JSON from a closure contract YAML.

The closure contract is the machine-readable source of truth for what a
workstream closure means. This generator validates the contract against
gates.yaml and produces:
  1. A plan JSON that acceptance-run.py consumes.
  2. A contract manifest JSON that closure gates read for their scan targets.

No AI involvement. The contract is authoritative; the generator only
translates and validates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
ACCEPTANCE_ROOT = REPO_ROOT / "tooling" / "acceptance"

CLOSURE_GATE_IDS = {
    "chat-w11-forbidden-scan",
    "chat-w11-duplicate-scan",
    "chat-w11-completion-audit",
}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError:
        return _minimal_yaml_parse(path.read_text(encoding="utf-8"))
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _minimal_yaml_parse(text: str) -> dict[str, Any]:
    """Parse the subset of YAML used by closure contracts without PyYAML.

    Closure contracts use: mappings, sequences, strings, ints, bools,
    block scalars (>), and comments.
    """
    import re

    lines = text.splitlines()
    return _parse_yaml_block(lines, 0, 0)[0]


def _parse_yaml_block(lines: list[str], start: int, indent: int) -> tuple[dict[str, Any], int]:
    result: dict[str, Any] = {}
    i = start
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        current_indent = len(line) - len(stripped)
        if current_indent < indent:
            break
        if current_indent > indent:
            i += 1
            continue

        if stripped.startswith("- "):
            i += 1
            continue

        if ":" not in stripped:
            i += 1
            continue

        key, _, value = stripped.partition(":")
        key = key.strip()
        value = value.strip()

        if value == ">" or value == "|":
            block_lines = []
            i += 1
            while i < len(lines):
                next_line = lines[i]
                next_stripped = next_line.lstrip()
                if not next_stripped or next_stripped.startswith("#"):
                    i += 1
                    continue
                next_indent = len(next_line) - len(next_stripped)
                if next_indent <= current_indent:
                    break
                block_lines.append(next_stripped)
                i += 1
            result[key] = " ".join(block_lines)
            continue

        if value == "":
            i += 1
            sub_result, new_i = _parse_yaml_value(lines, i, current_indent + 2)
            result[key] = sub_result
            i = new_i
            continue

        result[key] = _parse_scalar(value)
        i += 1

    return result, i


def _parse_yaml_value(lines: list[str], start: int, indent: int) -> tuple[Any, int]:
    if start >= len(lines):
        return None, start

    line = lines[start]
    stripped = line.lstrip()

    if stripped.startswith("- "):
        items = []
        i = start
        while i < len(lines):
            line = lines[i]
            stripped = line.lstrip()
            if not stripped or stripped.startswith("#"):
                i += 1
                continue
            current_indent = len(line) - len(stripped)
            if current_indent < indent:
                break
            if not stripped.startswith("- "):
                break
            value = stripped[2:].strip()
            if value == "":
                i += 1
                sub, new_i = _parse_yaml_block(lines, i, indent + 2)
                items.append(sub)
                i = new_i
            else:
                items.append(_parse_scalar(value))
                i += 1
        return items, i

    return _parse_yaml_block(lines, start, indent)


def _parse_scalar(value: str) -> Any:
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null" or value == "~":
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


def validate_contract(contract: dict[str, Any], gate_defs: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    required_fields = {"version", "workstream", "deliverables", "gate_order"}
    for field in required_fields:
        if field not in contract:
            errors.append(f"contract missing required field: {field}")

    deliverables = contract.get("deliverables", [])
    if not isinstance(deliverables, list) or not deliverables:
        errors.append("contract must have at least one deliverable")

    for i, d in enumerate(deliverables):
        if not isinstance(d, dict):
            errors.append(f"deliverable[{i}] must be a mapping")
            continue
        if "id" not in d:
            errors.append(f"deliverable[{i}] missing id")
        if "verify" not in d:
            errors.append(f"deliverable[{i}] missing verify")
        else:
            v = d["verify"]
            vtype = v.get("type")
            if vtype not in {
                "path-absent",
                "source-scan",
                "no-duplicate-symbol",
                "http-route-absent",
                "tauri-command-absent",
                "gates-passed",
                "gate-passed",
            }:
                errors.append(f"deliverable[{i}] unknown verify type: {vtype!r}")

            if vtype in {"gates-passed", "gate-passed"}:
                gate_ids = v.get("gates", [])
                if vtype == "gate-passed":
                    gate_ids = [v.get("gate", "")]
                for gid in gate_ids:
                    if not gid:
                        errors.append(f"deliverable[{i}] has empty gate id")
                    elif gid not in gate_defs:
                        errors.append(
                            f"deliverable[{i}] references unknown gate: {gid!r}"
                        )

    gate_order = contract.get("gate_order", [])
    if not isinstance(gate_order, list) or not gate_order:
        errors.append("contract must have non-empty gate_order")
    for gid in gate_order:
        if gid not in gate_defs:
            errors.append(f"gate_order references unknown gate: {gid!r}")

    closure_gates_in_order = {g for g in gate_order if g in CLOSURE_GATE_IDS}
    if not closure_gates_in_order:
        errors.append(
            "gate_order must include at least one closure gate "
            "(chat-w11-forbidden-scan, chat-w11-duplicate-scan, "
            "chat-w11-completion-audit)"
        )

    return errors


def generate_plan(contract: dict[str, Any], gate_defs: dict[str, Any]) -> dict[str, Any]:
    gate_order: list[str] = contract["gate_order"]

    selected_gates = []
    for gid in gate_order:
        gdef = gate_defs[gid]
        planned_gate = {
            "id": gid,
            "command": gdef["command"],
            "timeout_seconds": gdef.get("timeout_seconds", 600),
            "environment": gdef.get("environment", "local"),
            "provisioner": gdef.get("provisioner", ""),
            "tier": gdef.get("tier", "local-evidence"),
            "description": gdef.get("description", ""),
            "required_by": [f"closure:{contract['workstream']}"],
        }
        required_cells = gdef.get("requiredRuntimeCells")
        if required_cells:
            planned_gate["requiredRuntimeCells"] = required_cells
        selected_gates.append(planned_gate)

    return {
        "version": 1,
        "plan": f"closure-{contract['workstream'].lower()}",
        "description": contract.get("description", ""),
        "closure_contract": contract["id"] if "id" in contract else contract["workstream"],
        "selected_gates": selected_gates,
    }


def generate_manifest(contract: dict[str, Any]) -> dict[str, Any]:
    """Produce a manifest that closure gates read for their scan targets.

    This eliminates hardcoded path lists in gate scripts. The contract
    is the single source of truth.
    """
    manifest: dict[str, Any] = {
        "version": 1,
        "workstream": contract["workstream"],
        "scan_targets": {},
    }

    for d in contract.get("deliverables", []):
        did = d["id"]
        verify = d["verify"]
        vtype = verify["type"]

        if vtype == "path-absent":
            manifest["scan_targets"][did] = {
                "type": "path-absent",
                "paths": verify.get("paths", []),
            }
        elif vtype == "source-scan":
            manifest["scan_targets"][did] = {
                "type": "source-scan",
                "include_dirs": verify.get("include_dirs", []),
                "skip_dirs": verify.get("skip_dirs", []),
                "allowed_file_prefixes": verify.get("allowed_file_prefixes", []),
                "patterns": verify.get("patterns", []),
            }
        elif vtype == "no-duplicate-symbol":
            manifest["scan_targets"][did] = {
                "type": "no-duplicate-symbol",
                "owner_dir": verify.get("owner_dir", ""),
                "check_dirs": verify.get("check_dirs", []),
                "skip_dirs": verify.get("skip_dirs", []),
                "functions": verify.get("functions", []),
                "types": verify.get("types", []),
                "duplicate_struct_check": verify.get("duplicate_struct_check", []),
            }
        elif vtype == "http-route-absent":
            manifest["scan_targets"][did] = {
                "type": "http-route-absent",
                "route_prefixes": verify.get("route_prefixes", []),
                "search_dirs": verify.get("search_dirs", []),
                "skip_dirs": verify.get("skip_dirs", []),
                "exempt_files": verify.get("exempt_files", []),
            }
        elif vtype == "tauri-command-absent":
            manifest["scan_targets"][did] = {
                "type": "tauri-command-absent",
                "commands": verify.get("commands", []),
                "search_files": verify.get("search_files", []),
            }
        elif vtype == "gates-passed":
            manifest["scan_targets"][did] = {
                "type": "gates-passed",
                "gates": verify.get("gates", []),
            }
        elif vtype == "gate-passed":
            manifest["scan_targets"][did] = {
                "type": "gate-passed",
                "gate": verify.get("gate", ""),
            }

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate acceptance plan from closure contract"
    )
    parser.add_argument(
        "--contract",
        required=True,
        help="Path to closure contract YAML",
    )
    parser.add_argument(
        "--output",
        help="Output plan JSON path (default: stdout or reports/plan.json)",
    )
    parser.add_argument(
        "--manifest-output",
        help="Output contract manifest JSON path",
    )
    parser.add_argument(
        "--gates",
        default=str(ACCEPTANCE_ROOT / "gates.yaml"),
        help="Path to gates.yaml",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print plan without writing files",
    )
    args = parser.parse_args()

    contract_path = Path(args.contract)
    if not contract_path.is_absolute():
        contract_path = REPO_ROOT / contract_path
    if not contract_path.exists():
        print(f"contract not found: {contract_path}", file=sys.stderr)
        return 1

    contract = load_yaml(contract_path)
    gate_defs = load_json(Path(args.gates)).get("gates", {})

    errors = validate_contract(contract, gate_defs)
    if errors:
        print("Closure contract validation failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    plan = generate_plan(contract, gate_defs)
    manifest = generate_manifest(contract)

    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return 0

    if args.output:
        out_path = Path(args.output)
        if not out_path.is_absolute():
            out_path = REPO_ROOT / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(plan, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"plan: {out_path}")
    else:
        print(json.dumps(plan, indent=2))

    if args.manifest_output:
        manifest_path = Path(args.manifest_output)
        if not manifest_path.is_absolute():
            manifest_path = REPO_ROOT / manifest_path
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"manifest: {manifest_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
