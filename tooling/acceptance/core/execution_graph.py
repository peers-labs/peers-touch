"""Compile explicit proof dependencies; never infer reuse from command text."""

from __future__ import annotations

import re
from typing import Any, Mapping

from .execution_budget import ExecutionBudgetError, digest


class ExecutionGraph(dict[str, Any]):
    """Closed compiler metadata; its original identity survives serialization."""

    def __init__(self, value: Mapping[str, Any]) -> None:
        super().__init__(value)
        self._compiled_digest = value.get("digest")
        self.validate()

    def validate(self) -> None:
        fields = {
            "artifactKind", "selectedGateIds", "dispatchGateIds",
            "producerGateIds", "dependencies", "definitionDigests",
            "reusePolicy", "digest",
        }
        if set(self) != fields or self.get("artifactKind") != "acceptance-execution-graph":
            raise ExecutionBudgetError("execution graph metadata has unknown or missing fields")
        order = self["dispatchGateIds"]
        for name in ("selectedGateIds", "dispatchGateIds", "producerGateIds"):
            ids = self[name]
            if (
                not isinstance(ids, list)
                or any(not isinstance(item, str) or not re.fullmatch(
                    r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", item
                ) for item in ids)
                or len(set(ids)) != len(ids)
            ):
                raise ExecutionBudgetError("execution graph metadata contains invalid Gate IDs")
        if not set(self["selectedGateIds"]) <= set(order) or not set(self["producerGateIds"]) <= set(order):
            raise ExecutionBudgetError("execution graph metadata scope mismatch")
        edges, identities = self["dependencies"], self["definitionDigests"]
        if (
            not isinstance(edges, dict) or not isinstance(identities, dict)
            or set(edges) != set(order) or set(identities) != set(order)
        ):
            raise ExecutionBudgetError("execution graph metadata inventory mismatch")
        positions = {gate: index for index, gate in enumerate(order)}
        for gate, required in edges.items():
            if (
                not isinstance(required, list)
                or any(not isinstance(producer, str) for producer in required)
                or len(set(required)) != len(required)
                or any(producer not in positions or positions[producer] >= positions[gate]
                       for producer in required)
                or not isinstance(identities[gate], str)
                or not re.fullmatch(r"[0-9a-f]{64}", identities[gate])
            ):
                raise ExecutionBudgetError("execution graph metadata dependency or definition mismatch")
        if (
            self["reusePolicy"] != "explicit-prerequisites; no command-equality inference"
            or self["digest"] != self._compiled_digest
            or digest({key: value for key, value in self.items() if key != "digest"})
            != self._compiled_digest
        ):
            raise ExecutionBudgetError("execution graph metadata digest mismatch")


def dependencies(gate_id: str, definition: Mapping[str, Any]) -> tuple[str, ...]:
    values = definition.get("dependsOn", [])
    if (
        not isinstance(values, list)
        or any(not isinstance(value, str) or not value for value in values)
        or len(set(values)) != len(values)
        or gate_id in values
    ):
        raise ExecutionBudgetError(f"{gate_id}: invalid dependsOn")
    return tuple(values)


def validate_judgment(gate_id: str, definition: Mapping[str, Any]) -> None:
    """One structural-judgment contract for execution and report projections."""
    if "judgment" in definition and (
        definition["judgment"] != "all-prerequisites"
        or not dependencies(gate_id, definition)
        or "command" in definition or "argv" in definition
        or definition.get("environment", "local") != "local"
        or definition.get("provisioner")
        or definition.get("tier", "local-evidence") not in {"ci-structure", "ci-cheap", "local-evidence"}
        or definition.get("requiredRuntimeCells")
        or definition.get("ephemeralCapabilities")
    ):
        raise ExecutionBudgetError(f"{gate_id}: invalid structural prerequisite judgment")


def compile_graph(
    definitions: Mapping[str, Any], selected_ids: list[str], *,
    excluded_ids: tuple[str, ...] = (),
) -> ExecutionGraph:
    """Selected consumers include their prerequisite closure, once, in order."""
    if len(set(selected_ids)) != len(selected_ids):
        raise ExecutionBudgetError("execution graph contains duplicate selection")
    order: list[str] = []
    visiting: set[str] = set()
    visited: set[str] = set()
    edges: dict[str, list[str]] = {}

    def visit(gate_id: str) -> None:
        if gate_id not in definitions:
            raise ExecutionBudgetError(f"execution graph references missing Gate {gate_id}")
        if gate_id in excluded_ids:
            raise ExecutionBudgetError(f"required dependency is explicitly excluded: {gate_id}")
        if gate_id in visiting:
            raise ExecutionBudgetError(f"execution graph cycle at {gate_id}")
        if gate_id in visited:
            return
        visiting.add(gate_id)
        required = dependencies(gate_id, definitions[gate_id])
        definition = definitions[gate_id]
        validate_judgment(gate_id, definition)
        edges[gate_id] = list(required)
        for producer in required:
            visit(producer)
        visiting.remove(gate_id)
        visited.add(gate_id)
        order.append(gate_id)

    for gate_id in selected_ids:
        visit(gate_id)
    graph = {
        "artifactKind": "acceptance-execution-graph",
        "selectedGateIds": list(selected_ids),
        "dispatchGateIds": order,
        "producerGateIds": [gate_id for gate_id in order if "judgment" not in definitions[gate_id]],
        "dependencies": edges,
        "definitionDigests": {gate_id: digest(definitions[gate_id]) for gate_id in order},
        "reusePolicy": "explicit-prerequisites; no command-equality inference",
    }
    graph["digest"] = digest(graph)
    return ExecutionGraph(graph)


def prerequisite_results(
    gate: Mapping[str, Any], results: list[dict[str, Any]],
    source: Mapping[str, str], store: Any,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Require sealed current-source producer results, including cleanup."""
    from .evidence_store import ArtifactRef

    by_id = {result["id"]: result for result in results}
    references: list[dict[str, Any]] = []
    unproven: list[str] = []
    for producer in dependencies(gate["id"], gate):
        result = by_id.get(producer, {})
        reference = result.get("runManifest")
        if (
            result.get("status") != "passed"
            or result.get("completionStatus") != "DONE"
            or result.get("proofStatus") != "PROVEN"
            or result.get("cleanupStatus", "not-required") not in {"passed", "not-required"}
            or not reference
        ):
            unproven.append(producer)
            continue
        ref = ArtifactRef.from_dict(reference)
        manifest = store.read_run_manifest(
            ref, manifest_sha256=ref.sha256, expected_gate_id=producer,
        )
        if (
            ref.gate_id != producer
            or manifest.get("source") != dict(source)
            or manifest.get("result", {}).get("cleanupStatus", "not-required") not in {"passed", "not-required"}
            or any(manifest.get("result", {}).get(key) != value for key, value in (
                ("status", "passed"), ("completionStatus", "DONE"), ("proofStatus", "PROVEN"),
            ))
        ):
            raise ExecutionBudgetError(f"{producer}: prerequisite source or proof mismatch")
        references.append({"gateId": producer, "runManifest": reference})
    return references, unproven


def efficiency_report(graph: Mapping[str, Any], costs: list[dict[str, Any]]) -> dict[str, Any]:
    durations = [item["durationSeconds"] for item in costs]
    sorted_durations = sorted(durations)
    return {
        "graphDigest": graph["digest"],
        "selectedGateCount": len(graph["selectedGateIds"]),
        "uniqueProducerCount": len(graph["producerGateIds"]),
        "dependencyReferenceCount": sum(len(values) for values in graph["dependencies"].values()),
        "dispatchedGateCount": len(costs),
        "totalGateSeconds": round(sum(durations), 6),
        "observedP95Seconds": (
            sorted_durations[max(0, (len(sorted_durations) * 95 + 99) // 100 - 1)]
            if sorted_durations else None
        ),
        "overBudgetGateIds": [item["gateId"] for item in costs if item["state"] == "OVER_BUDGET"],
        "measurementBoundary": "heterogeneous Gate lifecycle samples; not product latency",
        "performanceStatus": "UNPROVEN",
        "mandatoryDuration": "UNPROVEN",
        "optimizationPolicy": "explicit prerequisites; fixed request and owner protections; proof unchanged",
    }
