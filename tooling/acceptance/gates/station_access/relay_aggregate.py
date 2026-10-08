#!/usr/bin/env python3
"""Aggregate exact-source Relay security and native client evidence."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field

from tooling.acceptance.core import (
    AcceptanceGate,
    EvidenceError,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)


SECURITY_GATE_ID = "station-access-relay-security-e2e"
UNIFIED_GATE_ID = "unified-relay-station-access-aggregate-e2e"
SPEC = (
    "docs/architecture/platform/station/access/execution-plans/"
    "20261006-unified-relay-station-access-v9/tasks/"
    "SAL-REL-07-NATIVE-ACCEPTANCE.md"
)


@dataclass(frozen=True)
class GateSpec:
    acceptance_id: str
    gate_id: str
    runtime_cell: str | None = None


SECURITY_GATES: tuple[GateSpec, ...] = (
    GateSpec("SAL-REL-01", "relay-role-security-contract"),
    GateSpec("SAL-REL-02", "relay-station-enrollment-e2e"),
    GateSpec("SAL-REL-03", "relay-endpoint-discovery-contract"),
    GateSpec("SAL-REL-04", "relay-opaque-tunnel-e2e"),
)

UNIFIED_GATES: tuple[GateSpec, ...] = (
    *SECURITY_GATES,
    GateSpec("SAL-REL-03", "station-dashboard-unit"),
    GateSpec("SAL-REL-03", "station-dashboard-web-check"),
    GateSpec(
        "SAL-REL-05",
        "station-access-desktop-relay-native-e2e",
        "desktop-macos-native",
    ),
    GateSpec(
        "SAL-REL-05",
        "station-access-desktop-relay-windows-e2e",
        "desktop-windows-native",
    ),
    GateSpec("SAL-REL-06", "station-access-mobile-relay-native-e2e"),
    GateSpec("SAL-REL-07", SECURITY_GATE_ID),
)


@dataclass
class GateResult:
    acceptance_id: str
    gate_id: str
    runtime_cell: str | None
    run_id: str | None
    status: str
    detail: str = ""


@dataclass
class AggregateResult:
    source: dict[str, str]
    gates: list[GateResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return (
            self.source.get("workspaceDigest") == "clean"
            and all(gate.status == "PASS" for gate in self.gates)
        )

    @property
    def unproven(self) -> bool:
        return (
            self.source.get("workspaceDigest") != "clean"
            or any(
                gate.status in {"MISSING", "STALE", "ERROR"}
                for gate in self.gates
            )
        )


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
    expected = {
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


class RelayAggregateGate(AcceptanceGate):
    phase = "SAL-REL-07"
    bom = ("SAL-REL-07-NATIVE-ACCEPTANCE",)
    spec = (SPEC,)
    preceding_gates: tuple[GateSpec, ...] = ()

    def __init__(
        self,
        *,
        store: EvidenceStore | None = None,
        expected_source: dict[str, str] | None = None,
    ) -> None:
        super().__init__()
        self.store = store or EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        self.expected_source = expected_source or source_identity(REPO_ROOT)

    def run(self) -> dict[str, object]:
        aggregate = AggregateResult(
            source=self.expected_source,
            gates=[
                check_gate(
                    self.store,
                    spec,
                    expected_source=self.expected_source,
                )
                for spec in self.preceding_gates
            ],
        )
        for gate in aggregate.gates:
            suffix = (
                f"[{gate.runtime_cell}]"
                if gate.runtime_cell
                else ""
            )
            self.report.add_assertion(
                f"{gate.acceptance_id}-{gate.gate_id}{suffix}",
                gate.status == "PASS",
                gate.detail or gate.status,
            )
        self.report.runtime.update(
            {
                "source": aggregate.source,
                "gateCount": len(aggregate.gates),
                "passedCount": sum(
                    gate.status == "PASS" for gate in aggregate.gates
                ),
                "gates": [asdict(gate) for gate in aggregate.gates],
            }
        )
        if not aggregate.passed:
            raise GateError(
                f"{self.gate_id} is incomplete: "
                + ", ".join(
                    f"{gate.gate_id}={gate.status}"
                    for gate in aggregate.gates
                    if gate.status != "PASS"
                )
            )
        return {
            "source": aggregate.source,
            "gateCount": len(aggregate.gates),
            "passedCount": len(aggregate.gates),
        }


class RelaySecurityAggregateGate(RelayAggregateGate):
    gate_id = SECURITY_GATE_ID
    preceding_gates = SECURITY_GATES


class UnifiedRelayAggregateGate(RelayAggregateGate):
    gate_id = UNIFIED_GATE_ID
    preceding_gates = UNIFIED_GATES


def main() -> int:
    gate_id = os.environ.get("PT_ACCEPTANCE_GATE_ID", "").strip()
    gate_types = {
        SECURITY_GATE_ID: RelaySecurityAggregateGate,
        UNIFIED_GATE_ID: UnifiedRelayAggregateGate,
    }
    gate_type = gate_types.get(gate_id)
    if gate_type is None:
        raise GateError(f"unsupported Relay aggregate Gate: {gate_id}")
    return gate_type().execute()


if __name__ == "__main__":
    raise SystemExit(main())
