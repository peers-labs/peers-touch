"""Read-only E2E preparation inside the existing Gate execution lifecycle."""

from __future__ import annotations

import ast
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Mapping

from .execution_budget import ExecutionBudgetError, digest, positive_seconds
from .execution_graph import compile_graph

PREFLIGHT_ENV = "PT_ACCEPTANCE_E2E_PREFLIGHT"
LIFETIMES = {"implementation": 3, "suite": 2, "scenario": 1}
INVALIDATION_AXES = {
    "source", "catalog", "toolchain", "environment", "fixture", "client",
    "session", "oracle", "action-plan", "verification-mode",
}
MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_IMPLEMENTATIONS = 256
DEFAULT_TIMEOUT_SECONDS = 10.0


def implementation_path(root: Path, reference: str) -> tuple[Path, str]:
    path, separator, symbol = reference.partition("#")
    relative = Path(path)
    if (
        not separator or relative.is_absolute() or ".." in relative.parts
        or relative.suffix != ".py"
        or not re.fullmatch(r"[A-Za-z]\w*(?:\.[A-Za-z]\w*)*", symbol)
    ):
        raise ExecutionBudgetError(f"invalid public Python implementation ref: {reference}")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ExecutionBudgetError(f"implementation escapes source root: {reference}")
    return resolved, symbol


def string_list(value: Any, label: str, *, nonempty: bool = False) -> list[str]:
    if (
        not isinstance(value, list) or (nonempty and not value)
        or any(not isinstance(item, str) or not item.strip() for item in value)
        or len(set(value)) != len(value)
    ):
        raise ExecutionBudgetError(f"{label}: expected unique non-empty strings")
    return value


def validate_e2e_definition(gate_id: str, definition: Mapping[str, Any]) -> None:
    """Validate declarations only; missing business implementation is a run gap."""
    if "e2e" not in definition:
        return
    e2e = definition["e2e"]
    if not isinstance(e2e, dict) or set(e2e) != {"journeys", "implementations"}:
        raise ExecutionBudgetError(f"{gate_id}: e2e requires journeys and implementations")
    journeys, implementations = e2e["journeys"], e2e["implementations"]
    if (
        not isinstance(journeys, list) or not isinstance(implementations, list)
        or len(implementations) > MAX_IMPLEMENTATIONS or len(journeys) > MAX_IMPLEMENTATIONS
    ):
        raise ExecutionBudgetError(f"{gate_id}: invalid or oversized E2E inventory")
    ids: set[str] = set()
    for journey in journeys:
        if (
            not isinstance(journey, dict) or set(journey) != {"id", "uses"}
            or not isinstance(journey["id"], str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", journey["id"])
            or journey["id"] in ids
        ):
            raise ExecutionBudgetError(f"{gate_id}: invalid or repeated Journey")
        ids.add(journey["id"])
        string_list(journey["uses"], f"{gate_id}: Journey uses")
    refs: set[str] = set()
    for item in implementations:
        if not isinstance(item, dict) or set(item) != {
            "ref", "purpose", "lifetime", "dependsOn", "invalidatedBy",
        }:
            raise ExecutionBudgetError(f"{gate_id}: invalid implementation declaration")
        reference = item["ref"]
        if not isinstance(reference, str) or reference in refs:
            raise ExecutionBudgetError(f"{gate_id}: invalid or repeated implementation ref")
        implementation_path(Path("/source"), reference)
        refs.add(reference)
        if not isinstance(item["purpose"], str) or not item["purpose"].strip():
            raise ExecutionBudgetError(f"{gate_id}: implementation purpose is required")
        if not isinstance(item["lifetime"], str) or item["lifetime"] not in LIFETIMES:
            raise ExecutionBudgetError(f"{gate_id}: invalid implementation lifetime")
        string_list(item["dependsOn"], f"{gate_id}: implementation dependencies")
        axes = string_list(item["invalidatedBy"], f"{gate_id}: invalidation axes", nonempty=True)
        if "source" not in axes or set(axes) - INVALIDATION_AXES:
            raise ExecutionBudgetError(f"{gate_id}: invalid implementation invalidation axes")


def source_symbol(path: Path, symbol: str) -> str | None:
    """Parse declarations without importing the module or executing decorators."""
    if not path.is_file():
        return None
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ExecutionBudgetError(f"E2E source exceeds read budget: {path.name}")
    text = path.read_text(encoding="utf-8")
    declarations = ast.parse(text, filename=str(path)).body
    for part in symbol.split("."):
        matches = [
            node for node in declarations
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == part
        ]
        if len(matches) != 1:
            return None
        declarations = matches[0].body
    meaningful = [
        node for node in declarations
        if not (
            isinstance(node, ast.Pass)
            or isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
            and (isinstance(node.value.value, str) or node.value.value is Ellipsis)
        )
    ]
    if not meaningful or all(
        isinstance(node, ast.Raise) and (
            isinstance(node.exc, ast.Name) and node.exc.id == "NotImplementedError"
            or isinstance(node.exc, ast.Call) and isinstance(node.exc.func, ast.Name)
            and node.exc.func.id == "NotImplementedError"
        ) for node in meaningful
    ):
        return None
    return digest(text)


def prepare_e2e(
    definitions: Mapping[str, Any], graph: Mapping[str, Any],
    source: Mapping[str, Any], *, repo_root: Path, catalog_path: Path,
    execution_policy: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Resolve implementation reuse for exactly the already compiled Gate closure."""
    started = time.monotonic()
    timeout_seconds = positive_seconds(timeout_seconds, "E2E preparation timeout")
    if execution_policy not in {"development", "acceptance"}:
        raise ExecutionBudgetError("invalid E2E preparation mode or time budget")
    current_graph = compile_graph(definitions, list(graph["selectedGateIds"]))
    if current_graph != graph:
        raise ExecutionBudgetError("E2E selection or dependency graph drift")
    inventory: dict[str, dict[str, Any]] = {}
    observations: dict[str, dict[str, Any]] = {}
    gates: list[dict[str, Any]] = []

    def check_time() -> None:
        if time.monotonic() - started >= timeout_seconds:
            raise ExecutionBudgetError("E2E preparation exceeded its read-only time budget")

    # Merge selected owners only. An implementation reference never selects a Gate.
    for gate_id in graph["dispatchGateIds"]:
        check_time()
        definition = definitions[gate_id]
        validate_e2e_definition(gate_id, definition)
        for item in definition.get("e2e", {}).get("implementations", []):
            reference = item["ref"]
            if reference in inventory and any(
                inventory[reference][key] != item[key]
                for key in ("lifetime", "dependsOn", "invalidatedBy")
            ):
                raise ExecutionBudgetError(f"conflicting implementation lifecycle: {reference}")
            inventory[reference] = item
    if len(inventory) > MAX_IMPLEMENTATIONS:
        raise ExecutionBudgetError("selected E2E implementation closure exceeds read budget")
    visiting: set[str] = set()

    def visit(reference: str) -> dict[str, Any]:
        check_time()
        if reference in visiting:
            raise ExecutionBudgetError(f"E2E implementation dependency cycle: {reference}")
        if reference in observations:
            return observations[reference]
        if reference not in inventory:
            observation = {
                "ref": reference, "disposition": "ENHANCE_REQUIRED",
                "owner": reference, "reason": "implementation dependency is not declared",
            }
        else:
            item = inventory[reference]
            visiting.add(reference)
            dependencies = []
            for required in item["dependsOn"]:
                if required in inventory and (
                    LIFETIMES[inventory[required]["lifetime"]] < LIFETIMES[item["lifetime"]]
                ):
                    raise ExecutionBudgetError(f"E2E dependency has shorter lifetime: {reference}")
                dependencies.append(visit(required))
            visiting.remove(reference)
            path, symbol = implementation_path(repo_root, reference)
            try:
                identity = source_symbol(path, symbol)
            except (OSError, UnicodeError, SyntaxError) as error:
                identity = None
                reason = f"source declaration cannot be read: {type(error).__name__}"
            else:
                reason = "public implementation is available" if identity else "public implementation is missing"
            available = bool(identity) and all(
                item["disposition"] == "REUSE_IMPLEMENTATION" for item in dependencies
            )
            observation = {
                **item, "owner": reference, "sourceDigest": identity,
                "disposition": "REUSE_IMPLEMENTATION" if available else "ENHANCE_REQUIRED",
                "reason": reason if available or not identity else "required implementation has a gap",
            }
        observations[reference] = observation
        return observation

    for gate_id in graph["dispatchGateIds"]:
        check_time()
        definition = definitions[gate_id]
        e2e = definition.get("e2e")
        if e2e is None:
            gates.append({"gateId": gate_id, "disposition": "NOT_DECLARED"})
            continue
        declared_observations = [visit(item["ref"]) for item in e2e["implementations"]]
        journeys = []
        for journey in e2e["journeys"]:
            uses = [visit(reference) for reference in journey["uses"]]
            journeys.append({
                **journey,
                "disposition": "REUSE_IMPLEMENTATION" if uses and all(
                    item["disposition"] == "REUSE_IMPLEMENTATION" for item in uses
                ) else "ENHANCE_REQUIRED",
            })
        ready = bool(journeys) and all(
            item["disposition"] == "REUSE_IMPLEMENTATION" for item in journeys
        ) and all(
            item["disposition"] == "REUSE_IMPLEMENTATION" for item in declared_observations
        )
        gates.append({
            "gateId": gate_id,
            "disposition": "REUSE_IMPLEMENTATION" if ready else "ENHANCE_REQUIRED",
            "gapKind": None if ready else "BUSINESS_INJECTION_REQUIRED",
            "owner": definition.get("argv", definition.get("command", gate_id)),
            "journeys": journeys,
            "resources": {
                "disposition": "QUALIFY_AT_OWNER",
                **{key: definition.get(key) for key in (
                    "environment", "provisioner", "requiredRuntimeCells",
                    "ephemeralCapabilities", "executionInputs", "timeout_seconds",
                )},
            },
        })
    check_time()
    report = {
        "artifactKind": "acceptance-e2e-preflight",
        "catalogPath": str(catalog_path.resolve()),
        "catalogDigest": digest(definitions),
        "source": dict(source), "executionPolicy": execution_policy,
        "graphDigest": graph["digest"],
        "selectedGateIds": list(graph["selectedGateIds"]),
        "dispatchGateIds": list(graph["dispatchGateIds"]),
        "gates": gates, "implementations": list(observations.values()),
        "ready": all(item["disposition"] != "ENHANCE_REQUIRED" for item in gates),
        "proofStatus": "UNPROVEN",
    }
    report["digest"] = digest(report)
    return report


def require_ready(report: Mapping[str, Any]) -> None:
    if not report["ready"]:
        missing = [item["gateId"] for item in report["gates"] if item["disposition"] == "ENHANCE_REQUIRED"]
        raise ExecutionBudgetError(f"E2E ENHANCE_REQUIRED at original owner: {', '.join(missing)}")


def preflight_binding(report: Mapping[str, Any]) -> str:
    """A description of resolved work, never an authorization or receipt."""
    return json.dumps({
        key: report[key] for key in (
            "catalogPath", "source", "executionPolicy", "selectedGateIds", "digest",
        )
    }, separators=(",", ":"), sort_keys=True)


def load_catalog(path: Path) -> dict[str, Any]:
    def unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ExecutionBudgetError(f"duplicate catalog field: {key}")
            value[key] = item
        return value
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_pairs)["gates"]


def revalidate_preflight(
    report: Mapping[str, Any], source: Mapping[str, Any], *, repo_root: Path,
) -> None:
    if dict(source) != report["source"]:
        raise ExecutionBudgetError("E2E source changed after preparation")
    definitions = load_catalog(Path(report["catalogPath"]))
    current = prepare_e2e(
        definitions, compile_graph(definitions, list(report["selectedGateIds"])), source,
        repo_root=repo_root, catalog_path=Path(report["catalogPath"]),
        execution_policy=report["executionPolicy"],
    )
    if current["digest"] != report["digest"]:
        raise ExecutionBudgetError("E2E implementation, catalog or selection changed after preparation")
    require_ready(current)


def preflight_gate_entry(gate_id: str, *, repo_root: Path | None = None) -> dict[str, Any] | None:
    """Independent Gate entry resolves locally or rechecks its parent's exact scope."""
    from .evidence_store import source_identity

    root = repo_root or Path(__file__).resolve().parents[3]
    raw = os.environ.get(PREFLIGHT_ENV)
    binding = json.loads(raw) if raw else None
    catalog = Path(binding["catalogPath"]) if binding else root / "tooling/acceptance/gates.yaml"
    definitions = load_catalog(catalog)
    if not binding and (gate_id not in definitions or "e2e" not in definitions[gate_id]):
        return None
    selected = binding["selectedGateIds"] if binding else [gate_id]
    graph = compile_graph(definitions, selected)
    if gate_id not in graph["dispatchGateIds"]:
        raise ExecutionBudgetError(f"child Gate is outside E2E request closure: {gate_id}")
    source = source_identity(root)
    if binding and binding["source"] != source:
        raise ExecutionBudgetError("E2E child source changed after preparation")
    report = prepare_e2e(
        definitions, graph, source, repo_root=root, catalog_path=catalog,
        execution_policy=binding["executionPolicy"] if binding else os.environ.get(
            "PT_ACCEPTANCE_EXECUTION_POLICY", "acceptance",
        ),
    )
    if binding and report["digest"] != binding["digest"]:
        raise ExecutionBudgetError("E2E child contract changed after preparation")
    require_ready(report)
    return report
