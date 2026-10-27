#!/usr/bin/env python3
"""Aggregate current-source Chat storage governance proof."""

from __future__ import annotations

from dataclasses import asdict

from tooling.acceptance.core import (
    AcceptanceGate,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)
from tooling.acceptance.station_access_evidence import (
    AggregateResult, GateSpec, check_gate,
)


GATE_ID = "chat-storage-governance-aggregate-e2e"


PRECEDING_GATES: tuple[GateSpec, ...] = (
    GateSpec("CSG-G00", "chat-storage-contract"),
    GateSpec("CSG-G01", "chat-storage-accounting-e2e"),
    GateSpec("CSG-G02", "chat-storage-cache-clear-e2e"),
    GateSpec("CSG-G03", "chat-storage-retention-e2e"),
    GateSpec("CSG-G05", "chat-storage-redaction-recovery-e2e"),
    GateSpec("CSG-G04", "chat-storage-delete-reclaim-e2e"),
    GateSpec("CSG-G04", "chat-storage-dead-contract-zero-e2e"),
    GateSpec("CSG-G06", "chat-storage-zero-legacy-e2e"),
    GateSpec("CSG-G06", "desktop-release-build"),
    GateSpec("CSG-G06", "mobile-native-build"),
)


def build_report(aggregate: AggregateResult) -> dict[str, object]:
    status = (
        "PASS"
        if aggregate.passed
        else "UNPROVEN"
        if aggregate.unproven
        else "FAIL"
    )
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": GATE_ID,
        "gate": GATE_ID,
        "status": status,
        "completionStatus": "DONE" if aggregate.passed else "PARTIAL",
        "proofStatus": "PROVEN" if aggregate.passed else "UNPROVEN",
        "phase": "CSG-06",
        "bom": [
            "CSG-G00",
            "CSG-G01",
            "CSG-G02",
            "CSG-G03",
            "CSG-G04",
            "CSG-G05",
            "CSG-G06",
        ],
        "spec": [
            "docs/architecture/domains/chat/storage-governance/acceptance-matrix.md",
            "docs/architecture/domains/chat/storage-governance/decisions.md",
        ],
        "sampleEmissionAllowed": aggregate.passed,
        "source": aggregate.source,
        "gateCount": len(aggregate.gates),
        "passedCount": sum(gate.status == "PASS" for gate in aggregate.gates),
        "failedCount": sum(gate.status == "FAIL" for gate in aggregate.gates),
        "missingCount": sum(
            gate.status == "MISSING" for gate in aggregate.gates
        ),
        "staleCount": sum(gate.status == "STALE" for gate in aggregate.gates),
        "errorCount": sum(gate.status == "ERROR" for gate in aggregate.gates),
        "gates": [asdict(gate) for gate in aggregate.gates],
        "assertions": [
            {
                "name": f"{gate.acceptance_id}-{gate.gate_id}",
                "passed": gate.status == "PASS",
                "detail": gate.detail or gate.status,
            }
            for gate in aggregate.gates
        ],
    }


class ChatStorageGovernanceAggregateGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "CSG-06"
    bom = (
        "CSG-G00",
        "CSG-G01",
        "CSG-G02",
        "CSG-G03",
        "CSG-G04",
        "CSG-G05",
        "CSG-G06",
    )
    spec = (
        "docs/architecture/domains/chat/storage-governance/acceptance-matrix.md",
        "docs/architecture/domains/chat/storage-governance/decisions.md",
    )

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
                for spec in PRECEDING_GATES
            ],
        )
        report = build_report(aggregate)
        for gate in aggregate.gates:
            self.report.add_assertion(
                f"{gate.acceptance_id}-{gate.gate_id}",
                gate.status == "PASS",
                gate.detail or gate.status,
            )
        self.report.runtime.update(
            {
                "source": aggregate.source,
                "gateCount": report["gateCount"],
                "passedCount": report["passedCount"],
                "failedCount": report["failedCount"],
                "missingCount": report["missingCount"],
                "staleCount": report["staleCount"],
                "errorCount": report["errorCount"],
                "gates": report["gates"],
            }
        )
        if not aggregate.passed:
            raise GateError(
                "Chat storage governance aggregate is incomplete: "
                + ", ".join(
                    f"{gate.gate_id}={gate.status}"
                    for gate in aggregate.gates
                    if gate.status != "PASS"
                )
            )
        return {
            "gateCount": len(aggregate.gates),
            "passedCount": len(aggregate.gates),
        }


def main() -> int:
    return ChatStorageGovernanceAggregateGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
