#!/usr/bin/env python3
"""Validate acceptance capability/domain consistency."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    ArtifactSession,
    EnvironmentContract,
    EvidenceStore,
    RUN_GATE_ENV,
    source_identity,
)
from tooling.acceptance.core.errors import EvidenceManifestInvalid, ProvisioningError
from tooling.acceptance.finalizers import (
    load_strict_json_object,
    loads_strict_json_value,
)
from tooling.acceptance.provisioners import get_provisioner

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
    "mobile-native",
    "native-tauri-embedded-webdriver",
}


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"required acceptance file is missing: {path}")
    try:
        return load_strict_json_object(path, str(path))
    except ValueError as error:
        raise RuntimeError(str(error)) from error


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


def validate_finalizer_contracts(
    acceptance_root: Path,
    gate_defs: dict[str, Any],
) -> dict[str, Any]:
    has_catalog_config = any(
        isinstance(gate, dict) and "evidenceFinalizer" in gate
        for gate in gate_defs.values()
    )
    has_capability_declaration = any(
        "finalizerRegistry" in load(path)
        or "requiredEvidenceFinalizers" in load(path)
        for path in sorted((acceptance_root / "capabilities").glob("*.yaml"))
    )
    if not has_catalog_config and not has_capability_declaration:
        return {}

    from tooling.acceptance.finalizers import load_finalizer_bindings

    return dict(load_finalizer_bindings(acceptance_root, gate_defs))


def run_plan_for_paths(repo_root: Path, acceptance_root: Path, paths: list[str]) -> dict[str, Any]:
    script = repo_root / "tooling/scripts/acceptance-plan.py"
    code = (
        "import importlib.util, json, pathlib, sys\n"
        f"sys.path.insert(0, {str(script.parent)!r})\n"
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


def validate_gate_catalog(
    gate_defs: dict[str, Any],
    required_gate_ids: set[str],
) -> None:
    require(gate_defs, "gates.yaml has no gates")
    missing_gate_ids = sorted(required_gate_ids - gate_defs.keys())
    require(
        not missing_gate_ids,
        f"STRUCTURAL_GAP: required gates missing from gates.yaml: {missing_gate_ids}",
    )
    for gate_id in sorted(required_gate_ids):
        gate = gate_defs[gate_id]
        validate_gate_launch(gate_id, gate)
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


def validate_gate_launch(gate_id: str, gate: dict[str, Any]) -> None:
    has_command = "command" in gate
    has_argv = "argv" in gate
    require(
        has_command != has_argv,
        f"{gate_id}: gate must define exactly one of command or argv",
    )

    if has_command:
        command = gate["command"]
        require(
            isinstance(command, str) and bool(command.strip()),
            f"{gate_id}: gate command must be a non-empty string",
        )
    else:
        argv = gate["argv"]
        require(
            isinstance(argv, list)
            and bool(argv)
            and all(
                isinstance(argument, str) and bool(argument)
                for argument in argv
            ),
            f"{gate_id}: gate argv must be a non-empty list of non-empty strings",
        )

    if "ephemeralCapabilities" not in gate:
        return

    capabilities = gate["ephemeralCapabilities"]
    require(
        isinstance(capabilities, list)
        and bool(capabilities)
        and all(
            isinstance(capability, str) and bool(capability)
            for capability in capabilities
        )
        and len(set(capabilities)) == len(capabilities),
        f"{gate_id}: ephemeralCapabilities must be a unique, non-empty list "
        "of non-empty strings",
    )
    require(has_argv, f"{gate_id}: ephemeralCapabilities requires argv")
    require(
        isinstance(argv, list) and is_supported_context_argv(argv),
        f"{gate_id}: ephemeralCapabilities requires a Python module, "
        "script, or -c argv",
    )


def is_supported_context_argv(argv: list[str]) -> bool:
    if len(argv) < 2 or not re.fullmatch(
        r"python(?:\d+(?:\.\d+)*)?",
        Path(argv[0]).name,
    ):
        return False
    if argv[1] == "-m":
        return len(argv) >= 3 and bool(
            re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", argv[2])
        )
    if argv[1] == "-c":
        return len(argv) >= 3
    return not argv[1].startswith("-") and Path(argv[1]).suffix == ".py"


def gate_launch_arguments(gate: dict[str, Any]) -> list[str]:
    if "argv" in gate:
        return list(gate["argv"])
    return str(gate["command"]).split()


def validate_gate_inheritance(
    repo_root: Path,
    gate_defs: dict[str, Any],
    required_gate_ids: set[str],
) -> None:
    """I1: Gates using python3 -m must contain an AcceptanceGate subclass."""
    violations: list[str] = []
    for gate_id in sorted(required_gate_ids & gate_defs.keys()):
        parts = gate_launch_arguments(gate_defs[gate_id])
        if "-m" not in parts and "-c" not in parts:
            continue
        try:
            module_index = parts.index("-m") + 1
        except ValueError:
            continue
        if module_index >= len(parts):
            continue
        module_path = parts[module_index].replace(".", "/")
        candidates = [
            repo_root / f"{module_path}.py",
            repo_root / module_path / "__main__.py",
        ]
        source = next((c for c in candidates if c.is_file()), None)
        if source is None:
            continue
        content = source.read_text(encoding="utf-8", errors="replace")
        if "AcceptanceGate" not in content:
            violations.append(gate_id)
    if violations:
        raise RuntimeError(
            "ACCEPTANCE_GATE_CONTRACT_VIOLATION: gates using python3 -m must "
            f"contain AcceptanceGate subclass: {violations}"
        )


def validate_gate_import_isolation(
    repo_root: Path,
    gate_defs: dict[str, Any],
    required_gate_ids: set[str],
) -> None:
    """I2: Gate runner modules must not import from other gate runner modules."""
    import re

    gate_modules: set[str] = set()
    gate_files: dict[str, tuple[Path, str]] = {}

    for gate_id in sorted(required_gate_ids & gate_defs.keys()):
        parts = gate_launch_arguments(gate_defs[gate_id])
        if "-m" not in parts:
            continue
        try:
            module_index = parts.index("-m") + 1
        except ValueError:
            continue
        if module_index >= len(parts):
            continue
        module_name = parts[module_index]
        gate_modules.add(module_name)
        module_path = module_name.replace(".", "/")
        source = repo_root / f"{module_path}.py"
        if source.is_file():
            gate_files[gate_id] = (source, module_name)

    import_pattern = re.compile(
        r"^(?:from|import)\s+(tooling\.acceptance\.gates\.\w+\.\w+)",
        re.MULTILINE,
    )
    violations: list[dict[str, str]] = []
    for gate_id, (source, own_module) in sorted(gate_files.items()):
        content = source.read_text(encoding="utf-8", errors="replace")
        for match in import_pattern.finditer(content):
            imported = match.group(1)
            if imported in gate_modules and imported != own_module:
                rel = str(source.relative_to(repo_root))
                violations.append(
                    {"gate": gate_id, "file": rel, "imports": imported}
                )
    if violations:
        raise RuntimeError(
            "ACCEPTANCE_GATE_IMPORT_VIOLATION: gate modules must not import "
            "from other gate modules. Extract shared code to a utility module "
            f"or tooling/acceptance/core/: {json.dumps(violations, sort_keys=True)}"
        )


def validate_synthetic_paths(
    repo_root: Path,
    capabilities: list[dict[str, Any]],
    features: list[dict[str, Any]],
) -> None:
    """I4: synthetic_paths and source_paths must point to existing files."""
    import glob as glob_module

    stale: list[dict[str, str]] = []

    def check_paths(source_id: str, paths: list[str]) -> None:
        for path_str in paths:
            if "*" in path_str or "?" in path_str or "[" in path_str:
                matches = glob_module.glob(
                    str(repo_root / path_str), recursive=True
                )
                if not matches:
                    stale.append({"source": source_id, "path": path_str, "type": "glob_no_match"})
            else:
                if not (repo_root / path_str).exists():
                    stale.append({"source": source_id, "path": path_str, "type": "missing"})

    for capability in capabilities:
        cap_id = str(capability.get("id", ""))
        for path_str in capability.get("synthetic_paths", []):
            check_paths(f"capability:{cap_id}", [path_str])
        for path_str in capability.get("source_paths", []):
            check_paths(f"capability:{cap_id}", [path_str])

    for feature in features:
        feat_id = str(feature.get("id", ""))
        for path_str in feature.get("synthetic_paths", []):
            check_paths(f"feature:{feat_id}", [path_str])
        for path_str in feature.get("source_paths", []):
            check_paths(f"feature:{feat_id}", [path_str])

    if stale:
        raise RuntimeError(
            "ACCEPTANCE_SYNTHETIC_PATH_STALE: paths in capability/feature "
            f"contracts do not exist: {json.dumps(stale[:20], sort_keys=True)}"
        )


def collect_domain_gate_closure(
    capabilities: list[dict[str, Any]],
    features: list[dict[str, Any]],
    validation_gate_id: str,
) -> tuple[set[str], dict[str, set[str]]]:
    features_by_id = {feature.get("id"): feature for feature in features}
    required_gates: set[str] = set()
    gate_sources: dict[str, set[str]] = {}

    for capability in capabilities:
        capability_id = str(capability.get("id") or "<missing>")
        for gate_id in capability.get("required_gates", []):
            required_gates.add(gate_id)
            gate_sources.setdefault(gate_id, set()).add(
                f"capability:{capability_id}"
            )
        for feature_id in capability.get("features", []):
            feature = features_by_id.get(feature_id)
            if feature is None:
                continue
            for gate_id in feature.get("required_gates", []):
                required_gates.add(gate_id)
                gate_sources.setdefault(gate_id, set()).add(
                    f"feature:{feature_id}"
                )

    if validation_gate_id:
        required_gates.add(validation_gate_id)
        gate_sources.setdefault(validation_gate_id, set()).add(
            "domain:validation_gate_id"
        )
    return required_gates, gate_sources


def validate_domain_contract_closure(
    acceptance_root: Path,
    domain_id: str,
    capabilities: list[dict[str, Any]],
    features: list[dict[str, Any]],
    gate_defs: dict[str, Any],
    validation_gate_id: str,
) -> set[str]:
    required_gates, gate_sources = collect_domain_gate_closure(
        capabilities,
        features,
        validation_gate_id,
    )
    failures: list[str] = []

    missing_gates = sorted(required_gates - gate_defs.keys())
    if missing_gates:
        failures.append(
            f"STRUCTURAL_GAP domain {domain_id!r}: required gates missing "
            "from gates.yaml: "
            + json.dumps(
                [
                    {
                        "gate": gate_id,
                        "sources": sorted(gate_sources.get(gate_id, set())),
                    }
                    for gate_id in missing_gates
                ],
                sort_keys=True,
            )
        )

    environment_gates: dict[str, set[str]] = {}
    provisioning_wiring: list[dict[str, str]] = []
    for gate_id in sorted(required_gates & gate_defs.keys()):
        gate = gate_defs[gate_id]
        environment = str(gate.get("environment") or "local")
        if environment == "local":
            continue
        environment_gates.setdefault(environment, set()).add(gate_id)
        provisioner_id = str(gate.get("provisioner") or "")
        if provisioner_id != environment:
            provisioning_wiring.append(
                {
                    "environment": environment,
                    "gate": gate_id,
                    "provisioner": provisioner_id or "<missing>",
                }
            )
    if provisioning_wiring:
        failures.append(
            f"PROVISIONING_WIRING_MISSING domain {domain_id!r}: non-local "
            "gates require provisioner == environment: "
            f"{json.dumps(provisioning_wiring, sort_keys=True)}"
        )

    missing_environments: dict[str, list[str]] = {}
    invalid_environments: list[dict[str, str]] = []
    unregistered_environments: list[dict[str, str]] = []
    for environment, gate_ids in sorted(environment_gates.items()):
        contract_path = (
            acceptance_root / "environments" / f"{environment}.yaml"
        )
        if not contract_path.is_file():
            missing_environments[environment] = sorted(gate_ids)
            continue
        try:
            contract = EnvironmentContract.from_yaml(contract_path)
        except ProvisioningError as error:
            invalid_environments.append(
                {
                    "environment": environment,
                    "error": str(error),
                }
            )
            continue
        if contract.id != environment:
            invalid_environments.append(
                {
                    "environment": environment,
                    "error": (
                        f"contract id {contract.id!r} does not match "
                        f"environment {environment!r}"
                    ),
                }
            )
            continue
        try:
            get_provisioner(contract)
        except ProvisioningError as error:
            unregistered_environments.append(
                {
                    "environment": environment,
                    "error": str(error),
                }
            )

    if missing_environments:
        failures.append(
            f"ENVIRONMENT_CONTRACT_MISSING domain {domain_id!r}: "
            "non-local gates require environments/<environment-id>.yaml: "
            f"{json.dumps(missing_environments, sort_keys=True)}"
        )
    if invalid_environments:
        failures.append(
            f"ENVIRONMENT_CONTRACT_INVALID domain {domain_id!r}: "
            f"{json.dumps(invalid_environments, sort_keys=True)}"
        )
    if unregistered_environments:
        failures.append(
            f"PROVISIONER_UNREGISTERED domain {domain_id!r}: "
            f"{json.dumps(unregistered_environments, sort_keys=True)}"
        )

    require(not failures, "\n".join(failures))
    validate_gate_catalog(gate_defs, required_gates)
    return required_gates


def latest_passed_gates(
    store: EvidenceStore,
    current_gate_id: str,
    require_run: bool,
) -> set[str]:
    def proven_gate_ids(
        results: object,
        *,
        label: str,
    ) -> set[str]:
        if not isinstance(results, list):
            raise RuntimeError(f"invalid {label}")
        proven: set[str] = set()
        seen: set[str] = set()
        for index, result in enumerate(results):
            if not isinstance(result, dict):
                raise RuntimeError(f"invalid {label} entry at index {index}")
            gate_id = result.get("id")
            status = result.get("status")
            if not isinstance(gate_id, str) or not gate_id:
                raise RuntimeError(f"invalid {label} id at index {index}")
            if gate_id in seen:
                raise RuntimeError(
                    f"invalid {label}: duplicate id {gate_id}"
                )
            seen.add(gate_id)
            if status not in {"passed", "dry-run", "failed", "blocked"}:
                raise RuntimeError(f"invalid {label} status at index {index}")
            if (
                status == "passed"
                and result.get("completionStatus") == "DONE"
                and result.get("proofStatus") == "PROVEN"
            ):
                proven.add(gate_id)
        return proven

    latest_missing = False
    try:
        latest_run_path = store.resolve(
            store.latest_artifact_ref("acceptance-run", "run")
        )
        run = load_strict_json_object(
            latest_run_path,
            "latest Acceptance run",
        )
    except EvidenceManifestInvalid:
        latest_missing = True
        run = {}
    except ValueError as error:
        raise RuntimeError("invalid latest Acceptance run") from error
    passed = proven_gate_ids(
        run.get("results", []),
        label="latest Acceptance results",
    )
    if run and run.get("source") != source_identity(REPO_ROOT):
        raise RuntimeError(
            "latest Acceptance run source does not match current source"
        )
    current_results = os.environ.get("PT_ACCEPTANCE_CURRENT_RESULTS", "")
    if current_results:
        try:
            current_envelope = loads_strict_json_value(
                current_results,
                "current Acceptance results",
            )
        except ValueError as error:
            raise RuntimeError("invalid current Acceptance results") from error
        if (
            not isinstance(current_envelope, dict)
            or set(current_envelope) != {"source", "results"}
            or current_envelope.get("source") != source_identity(REPO_ROOT)
        ):
            raise RuntimeError(
                "current Acceptance results source does not match current source"
            )
        in_progress_results = current_envelope["results"]
        current_proven = proven_gate_ids(
            in_progress_results,
            label="current Acceptance results",
        )
        current_gate_ids = {
            result.get("id")
            for result in in_progress_results
            if isinstance(result, dict)
            and isinstance(result.get("id"), str)
            and result.get("id")
        }
        passed.difference_update(current_gate_ids)
        passed.update(current_proven)
    if require_run and latest_missing and not current_results:
        raise EvidenceManifestInvalid("Acceptance run evidence is required")
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


def active_domain_ids(acceptance_root: Path) -> list[str]:
    index = load(acceptance_root / "domains" / "index.yaml")
    domains = [
        domain.get("id", "")
        for domain in index.get("domains", [])
        if domain.get("status") == "active"
    ]
    require(domains, "no active acceptance domains registered")
    return domains


def validate_domain(
    repo_root: Path,
    acceptance_root: Path,
    domain_id: str,
    require_proven: bool,
    store: EvidenceStore,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    domain = load(acceptance_root / "domains" / f"{domain_id}.yaml")
    require(domain.get("id") == domain_id, f"domain profile id mismatch: {domain_id}")
    capabilities = load_capabilities(acceptance_root)
    features = [load(path) for path in sorted((acceptance_root / "features").glob("*.yaml"))]
    gate_defs = load(acceptance_root / "gates.yaml").get("gates", {})
    validate_finalizer_contracts(acceptance_root, gate_defs)

    selected = []
    for capability_id in domain.get("capabilities", []):
        require(capability_id in capabilities, f"domain {domain_id}: capability {capability_id} is missing")
        selected.append(capabilities[capability_id])
    require(selected, f"domain {domain_id}: no capabilities selected")
    validation_gate_id = str(domain.get("validation_gate_id") or "")
    required_gates = validate_domain_contract_closure(
        acceptance_root,
        domain_id,
        selected,
        features,
        gate_defs,
        validation_gate_id,
    )
    validate_gate_inheritance(repo_root, gate_defs, required_gates)
    validate_gate_import_isolation(repo_root, gate_defs, required_gates)
    validate_synthetic_paths(repo_root, selected, features)
    passed_gates = latest_passed_gates(
        store,
        validation_gate_id,
        require_proven,
    )

    results = [
        validate_capability(repo_root, acceptance_root, capability, features, gate_defs, passed_gates, require_proven)
        for capability in selected
    ]
    return {"domain": domain_id, "capabilities": results}, results


def validate_infra(
    repo_root: Path,
    acceptance_root: Path,
    require_proven: bool,
    store: EvidenceStore,
    current_gate_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    capabilities = load_capabilities(acceptance_root)
    selected = [
        capability
        for capability in capabilities.values()
        if capability.get("direction") == "acceptance_core_self_validation"
    ]
    require(selected, "no acceptance_core_self_validation capabilities found")

    features = [
        load(path)
        for path in sorted((acceptance_root / "features").glob("*.yaml"))
    ]
    gate_defs = load(acceptance_root / "gates.yaml").get("gates", {})
    validate_finalizer_contracts(acceptance_root, gate_defs)
    required_gates = validate_domain_contract_closure(
        acceptance_root,
        "acceptance-infra",
        selected,
        features,
        gate_defs,
        current_gate_id,
    )
    validate_gate_inheritance(repo_root, gate_defs, required_gates)
    validate_gate_import_isolation(repo_root, gate_defs, required_gates)
    validate_synthetic_paths(repo_root, selected, features)
    passed_gates = latest_passed_gates(
        store,
        current_gate_id,
        require_proven,
    )
    results = [
        validate_capability(
            repo_root,
            acceptance_root,
            capability,
            features,
            gate_defs,
            passed_gates,
            require_proven,
        )
        for capability in selected
    ]
    return {"scope": "acceptance-infra", "capabilities": results}, results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--domain", default="")
    parser.add_argument("--infra", action="store_true")
    parser.add_argument("--require-proven", action="store_true")
    args = parser.parse_args()
    require(
        not (args.infra and args.domain),
        "--infra and --domain are mutually exclusive",
    )

    repo_root = REPO_ROOT
    acceptance_root = repo_root / args.root
    domain_ids = (
        []
        if args.infra
        else [args.domain] if args.domain else active_domain_ids(acceptance_root)
    )
    store = EvidenceStore.from_environment(
        repo_root=repo_root,
        worktree=repo_root,
    )
    if os.environ.get(RUN_GATE_ENV):
        gate_id = os.environ[RUN_GATE_ENV]
    elif args.infra:
        gate_id = "acceptance-infra-validation"
    elif len(domain_ids) == 1:
        profile = load(acceptance_root / "domains" / f"{domain_ids[0]}.yaml")
        gate_id = str(profile.get("validation_gate_id") or "acceptance-validate")
    else:
        gate_id = "acceptance-validate"

    print("Acceptance Domain Validation")
    print("============================")
    unproven: list[dict[str, Any]] = []
    with ArtifactSession(repo_root=repo_root, gate_id=gate_id) as session:
        if args.infra:
            report, results = validate_infra(
                repo_root,
                acceptance_root,
                args.require_proven,
                store,
                gate_id,
            )
            validation_items = [("acceptance-infra", report, results)]
        else:
            validation_items = []
            for domain_id in domain_ids:
                report, results = validate_domain(
                    repo_root,
                    acceptance_root,
                    domain_id,
                    args.require_proven,
                    store,
                )
                validation_items.append((domain_id, report, results))

        for target_id, report, results in validation_items:
            role = (
                "validation"
                if len(validation_items) == 1
                else f"validation:{target_id}"
            )
            reference = session.write_json(
                f"reports/{target_id}-validation.json",
                report,
                role=role,
            )
            print(f"[OK] scope: {target_id}")
            print(f"[OK] capabilities: {len(results)}")
            print(f"[OK] report: {json.dumps(reference.to_dict(), sort_keys=True)}")
            for result in results:
                print(f"[{result['status'].upper()}] {result['id']}")
                if args.require_proven and result["missing_run_gates"]:
                    print(f"  missing_run_gates: {', '.join(result['missing_run_gates'])}")
            if args.require_proven:
                unproven.extend(
                    result for result in results if result["status"] != "proven"
                )
        status = "passed" if not unproven else "failed"
        session.complete(
            status=status,
            completion_status="DONE" if not unproven else "PARTIAL",
            proof_status="PROVEN" if not unproven else "UNPROVEN",
        )

    return 0 if not unproven else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"acceptance validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
