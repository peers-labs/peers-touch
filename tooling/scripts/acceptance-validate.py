#!/usr/bin/env python3
"""Validate acceptance capability/domain consistency."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ALLOWED_GATE_TIERS = {
    "ci-structure",
    "ci-cheap",
    "local-evidence",
    "env-evidence",
    "nightly",
    "release",
}

ALLOWED_GATE_ENVIRONMENTS = {
    "local",
    "fedp5",
    "home-station",
    "local-desktop-gateway",
    "local-desktop-web-gateway",
}


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"required acceptance file is missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def load_capabilities(root: Path) -> dict[str, dict[str, Any]]:
    capabilities: dict[str, dict[str, Any]] = {}
    capability_dir = root / "capabilities"
    for path in sorted(capability_dir.glob("*.yaml")):
        for capability in load(path).get("capabilities", []):
            capability_id = capability.get("id")
            require(bool(capability_id), f"{path}: capability is missing id")
            require(capability_id not in capabilities, f"duplicate capability id: {capability_id}")
            capabilities[capability_id] = capability
    require(capabilities, f"no capabilities found under {capability_dir}")
    return capabilities


def run_plan_for_paths(repo_root: Path, acceptance_root: Path, paths: list[str]) -> dict[str, Any]:
    script = repo_root / "tooling/scripts/acceptance-plan.py"
    code = (
        "import importlib.util, json, pathlib\n"
        f"spec = importlib.util.spec_from_file_location('acceptance_plan', {str(script)!r})\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(module)\n"
        f"result = module.plan(pathlib.Path({str(acceptance_root)!r}), {paths!r})\n"
        "print(json.dumps(result, ensure_ascii=False))\n"
    )
    completed = subprocess.run(
        ["python3", "-c", code],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout)


def flatten_feature_gates(features: list[dict[str, Any]], feature_ids: list[str]) -> set[str]:
    by_id = {feature["id"]: feature for feature in features}
    gates: set[str] = set()
    for feature_id in feature_ids:
        feature = by_id.get(feature_id)
        require(feature is not None, f"capability references missing feature: {feature_id}")
        gates.update(feature.get("required_gates", []))
    return gates


def validate_gate_catalog(gate_defs: dict[str, Any]) -> None:
    require(gate_defs, "gates.yaml has no gates")
    for gate_id, gate in gate_defs.items():
        require(gate.get("command"), f"{gate_id}: gate command is required")
        environment = gate.get("environment", "local")
        tier = gate.get("tier")
        require(environment in ALLOWED_GATE_ENVIRONMENTS, f"{gate_id}: invalid environment {environment!r}")
        require(tier in ALLOWED_GATE_TIERS, f"{gate_id}: invalid or missing tier {tier!r}")
        if environment != "local":
            require(
                tier in {"env-evidence", "nightly", "release"},
                f"{gate_id}: non-local environment {environment!r} cannot use tier {tier!r}",
            )
        if tier in {"ci-structure", "ci-cheap"}:
            require(environment == "local", f"{gate_id}: CI tier gates must use local environment")


def latest_passed_gates(reports_dir: Path, current_gate_id: str, require_run: bool) -> set[str]:
    run_path = reports_dir / "latest-run.json"
    if not run_path.exists() and not require_run:
        return set()
    run = load(run_path)
    passed = {
        result.get("id", "")
        for result in run.get("results", [])
        if result.get("status") in {"passed", "dry-run"}
    }
    if current_gate_id:
        # The current process produces this gate's evidence and can only appear
        # in latest-run.json after the process exits.
        passed.add(current_gate_id)
    return passed


def validate_capability(
    repo_root: Path,
    acceptance_root: Path,
    capability: dict[str, Any],
    features: list[dict[str, Any]],
    gate_defs: dict[str, Any],
    passed_gates: set[str],
    require_proven: bool,
) -> dict[str, Any]:
    capability_id = capability.get("id")
    require(bool(capability_id), "capability is missing id")
    require(
        capability.get("direction")
        in {"acceptance_core_self_validation", "acceptance_validates_product", "product_domain_validates_acceptance"},
        f"{capability_id}: invalid direction",
    )

    feature_ids = capability.get("features", [])
    required_gates = set(capability.get("required_gates", []))
    require(feature_ids, f"{capability_id}: features are required")
    require(required_gates, f"{capability_id}: required_gates are required")

    feature_gates = flatten_feature_gates(features, feature_ids)
    missing_feature_gates = feature_gates - required_gates
    require(not missing_feature_gates, f"{capability_id}: capability omits feature required gates {sorted(missing_feature_gates)}")

    for gate_id in required_gates:
        require(gate_id in gate_defs, f"{capability_id}: gate {gate_id} missing from gates.yaml")

    synthetic_paths = capability.get("synthetic_paths", [])
    require(synthetic_paths, f"{capability_id}: synthetic_paths are required")
    planned = run_plan_for_paths(repo_root, acceptance_root, synthetic_paths)
    planned_features = set(planned.get("impacted_features", []))
    planned_gates = {gate["id"] for gate in planned.get("selected_gates", [])}
    missing_features = set(feature_ids) - planned_features
    missing_gates = required_gates - planned_gates
    require(not missing_features, f"{capability_id}: synthetic paths do not impact features {sorted(missing_features)}")
    require(not missing_gates, f"{capability_id}: synthetic paths do not select gates {sorted(missing_gates)}")

    evidence = capability.get("evidence", {})
    require(evidence.get("truth_sources"), f"{capability_id}: evidence truth_sources are required")
    require(evidence.get("proven_by"), f"{capability_id}: evidence proven_by is required")
    require(evidence.get("proven_scope"), f"{capability_id}: evidence proven_scope is required")

    proven_by = set(evidence.get("proven_by", []))
    missing_run_gates = proven_by - passed_gates
    status = "proven" if not missing_run_gates else "unproven"
    if not require_proven:
        status = "structurally_valid"
    return {
        "id": capability_id,
        "domain": capability.get("domain"),
        "direction": capability.get("direction"),
        "status": status,
        "features": feature_ids,
        "required_gates": sorted(required_gates),
        "planned_gates": sorted(planned_gates),
        "missing_run_gates": sorted(missing_run_gates),
        "proven_scope": evidence.get("proven_scope", []),
        "unproven_scope": evidence.get("unproven_scope", []),
    }


def write_report(path: Path, domain_id: str, results: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"domain": domain_id, "capabilities": results}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def active_domain_ids(acceptance_root: Path) -> list[str]:
    index = load(acceptance_root / "domains" / "index.yaml")
    domains = [
        domain.get("id", "")
        for domain in index.get("domains", [])
        if domain.get("status") == "active"
    ]
    require(domains, "no active acceptance domains registered")
    return domains


def validate_domain(repo_root: Path, acceptance_root: Path, domain_id: str, require_proven: bool) -> tuple[Path, list[dict[str, Any]]]:
    domain = load(acceptance_root / "domains" / f"{domain_id}.yaml")
    require(domain.get("id") == domain_id, f"domain profile id mismatch: {domain_id}")
    capabilities = load_capabilities(acceptance_root)
    features = [load(path) for path in sorted((acceptance_root / "features").glob("*.yaml"))]
    gate_defs = load(acceptance_root / "gates.yaml").get("gates", {})
    validate_gate_catalog(gate_defs)
    passed_gates = latest_passed_gates(acceptance_root / "reports", domain.get("validation_gate_id", ""), require_proven)

    selected = []
    for capability_id in domain.get("capabilities", []):
        require(capability_id in capabilities, f"domain {domain_id}: capability {capability_id} is missing")
        selected.append(capabilities[capability_id])
    require(selected, f"domain {domain_id}: no capabilities selected")

    results = [
        validate_capability(repo_root, acceptance_root, capability, features, gate_defs, passed_gates, require_proven)
        for capability in selected
    ]
    output = repo_root / domain.get("report", f"tooling/acceptance/reports/{domain_id}-validation.json")
    write_report(output, domain_id, results)
    return output, results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--domain", default="")
    parser.add_argument("--require-proven", action="store_true")
    args = parser.parse_args()

    repo_root = Path.cwd()
    acceptance_root = repo_root / args.root
    domain_ids = [args.domain] if args.domain else active_domain_ids(acceptance_root)

    print("Acceptance Domain Validation")
    print("============================")
    unproven: list[dict[str, Any]] = []
    for domain_id in domain_ids:
        output, results = validate_domain(repo_root, acceptance_root, domain_id, args.require_proven)
        print(f"[OK] domain: {domain_id}")
        print(f"[OK] capabilities: {len(results)}")
        print(f"[OK] report: {output}")
        for result in results:
            print(f"[{result['status'].upper()}] {result['id']}")
            if args.require_proven and result["missing_run_gates"]:
                print(f"  missing_run_gates: {', '.join(result['missing_run_gates'])}")
        if args.require_proven:
            unproven.extend(result for result in results if result["status"] != "proven")

    return 0 if not unproven else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"acceptance validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
