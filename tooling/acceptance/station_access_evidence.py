from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from tooling.acceptance.core import ArtifactRef, EvidenceError, EvidenceStore
from tooling.acceptance.core.proof import read_gate_proof, ProofIncomplete, ProofSourceMismatch
from tooling.acceptance.core.runtime_cell import runtime_source_matches


@dataclass(frozen=True)
class GateSpec:
    acceptance_id: str
    gate_id: str
    runtime_cell: str | None = None


@dataclass
class GateResult:
    acceptance_id: str
    gate_id: str
    run_id: str | None
    status: str
    detail: str = ""
    runtime_cell: str | None = None
    run_manifest: dict[str, Any] | None = None


@dataclass
class AggregateResult:
    source: dict[str, str]
    gates: list[GateResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return (
            runtime_source_matches(self.source, self.source)
            and bool(self.gates)
            and all(gate.status == "PASS" for gate in self.gates)
        )

    @property
    def unproven(self) -> bool:
        return (
            not runtime_source_matches(self.source, self.source)
            or not self.gates
            or any(gate.status in {"MISSING", "STALE", "ERROR"} for gate in self.gates)
        )


@dataclass(frozen=True)
class ProducerProofContext:
    """Only the current Runner's original prerequisite refs select producers."""

    source: dict[str, str]
    results: dict[str, dict[str, Any]]
    references: dict[str, ArtifactRef]

    @classmethod
    def from_environment(cls) -> ProducerProofContext:
        def unique_fields(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError("duplicate proof context field")
                value[key] = item
            return value

        envelope = json.loads(
            os.environ.get("PT_ACCEPTANCE_CURRENT_RESULTS", "{}"),
            object_pairs_hook=unique_fields,
        )
        references = json.loads(
            os.environ.get("PT_ACCEPTANCE_PREREQUISITE_PROOFS", "[]"),
            object_pairs_hook=unique_fields,
        )
        if (
            not isinstance(envelope, dict)
            or set(envelope) != {"source", "results"}
            or not isinstance(envelope["source"], dict)
            or not runtime_source_matches(envelope["source"], envelope["source"])
            or not isinstance(envelope["results"], list)
            or not isinstance(references, list)
        ):
            raise ValueError("current producer proof context is unavailable or invalid")
        results = {}
        for result in envelope["results"]:
            if (
                not isinstance(result, dict)
                or not isinstance(result.get("id"), str)
                or not result["id"]
                or result["id"] in results
            ):
                raise ValueError("current producer results contain invalid or repeated identities")
            results[result["id"]] = result
        refs = {}
        for item in references:
            if (
                not isinstance(item, dict)
                or set(item) != {"gateId", "runManifest"}
                or not isinstance(item["gateId"], str)
                or item["gateId"] in refs
            ):
                raise ValueError("original prerequisite references are invalid or repeated")
            ref = ArtifactRef.from_dict(item["runManifest"])
            if ref.gate_id != item["gateId"] or ref.path != "manifest.json":
                raise ValueError("original prerequisite reference identity changed")
            refs[item["gateId"]] = ref
        return cls(envelope["source"], results, refs)


def check_gate(
    store: EvidenceStore,
    spec: GateSpec,
    *,
    expected_source: dict[str, str],
    proof_context: ProducerProofContext | None = None,
) -> GateResult:
    def outcome(status: str, detail: str = "", ref: ArtifactRef | None = None):
        return GateResult(
            acceptance_id=spec.acceptance_id, gate_id=spec.gate_id,
            runtime_cell=spec.runtime_cell, run_id=ref.run_id if ref else None,
            status=status, detail=detail, run_manifest=ref.to_dict() if ref else None,
        )

    ref = None
    try:
        context = proof_context or ProducerProofContext.from_environment()
        if context.source != expected_source:
            return outcome("STALE", "current producer envelope source changed")
        ref = context.references.get(spec.gate_id)
        current = context.results.get(spec.gate_id)
        if ref is None or current is None:
            return outcome("MISSING", "current request has no original prerequisite proof")
        if (
            ref.workspace_id != store.workspace_id
            or current.get("runManifest") != ref.to_dict()
        ):
            return outcome("ERROR", "current result and original prerequisite reference differ", ref)
        read_gate_proof(
            store, spec.gate_id, expected_source, result=current,
            reference=ref, runtime_cell=spec.runtime_cell,
        )
    except ProofSourceMismatch:
        return outcome("STALE", "original producer source does not match aggregate source", ref)
    except ProofIncomplete:
        return outcome("FAIL", "original producer proof, cleanup or evidence scan did not pass", ref)
    except (EvidenceError, KeyError, TypeError, ValueError, OSError):
        return outcome("ERROR", "original producer context, manifest or complete inventory is invalid", ref)
    return outcome("PASS", ref=ref)
