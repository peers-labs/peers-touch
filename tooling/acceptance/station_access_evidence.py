from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tooling.acceptance.core import EvidenceError, EvidenceStore


@dataclass(frozen=True)
class GateSpec:
    acceptance_id: str
    gate_id: str
    runtime_cell: str | None = None


@dataclass
class GateResult:
    acceptance_id: str
    gate_id: str
    runtime_cell: str | None
    run_id: str | None
    status: str
    detail: str = ""


def check_gate(
    store: EvidenceStore,
    spec: GateSpec,
    *,
    expected_source: dict[str, str],
) -> GateResult:
    try:
        manifest = store.latest(
            spec.gate_id,
            runtime_cell=spec.runtime_cell,
        )
    except EvidenceError as error:
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            runtime_cell=spec.runtime_cell,
            run_id=None,
            status=(
                "MISSING"
                if "latest pointer is unavailable" in str(error)
                else "ERROR"
            ),
            detail=str(error),
        )
    run_id = manifest.get("runId")
    if (
        manifest.get("artifactKind") != "acceptance-run-manifest"
        or manifest.get("state") != "DURABLE"
        or manifest.get("workspaceId") != store.workspace_id
        or manifest.get("gateId") != spec.gate_id
        or not isinstance(run_id, str)
        or not run_id
    ):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            runtime_cell=spec.runtime_cell,
            run_id=run_id if isinstance(run_id, str) else None,
            status="ERROR",
            detail="authoritative latest manifest identity is invalid",
        )
    if manifest.get("source") != expected_source:
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            runtime_cell=spec.runtime_cell,
            run_id=run_id,
            status="STALE",
            detail="latest evidence source does not match aggregate source",
        )
    result = manifest.get("result")
    redaction = manifest.get("redaction")
    secret_scan = (
        result.get("secretScan")
        if isinstance(result, dict)
        else None
    )
    if (
        not isinstance(result, dict)
        or not isinstance(redaction, dict)
        or not isinstance(secret_scan, dict)
    ):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            runtime_cell=spec.runtime_cell,
            run_id=run_id,
            status="ERROR",
            detail="authoritative latest result metadata is invalid",
        )
    expected: dict[str, Any] = {
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
    }
    if (
        {key: result.get(key) for key in expected} != expected
        or secret_scan.get("status") != "passed"
        or redaction.get("status") != "passed"
    ):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            runtime_cell=spec.runtime_cell,
            run_id=run_id,
            status="FAIL",
            detail="latest result is not passed/DONE/PROVEN with clean evidence",
        )
    return GateResult(
        acceptance_id=spec.acceptance_id,
        gate_id=spec.gate_id,
        runtime_cell=spec.runtime_cell,
        run_id=run_id,
        status="PASS",
    )
