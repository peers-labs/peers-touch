#!/usr/bin/env python3
"""Aggregate exact-source batch conversation-clear proof."""

from __future__ import annotations

from dataclasses import dataclass

from tooling.acceptance.core import (
    AcceptanceGate,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)
from tooling.acceptance.gates.chat_storage.governance_aggregate import (
    GateResult,
    GateSpec,
    check_gate,
)


GATE_ID = "chat-storage-batch-clear-aggregate-e2e"
PRECEDING_GATES: tuple[GateSpec, ...] = (
    GateSpec("CSG-G00", "chat-storage-contract"),
    GateSpec("CSG-G07", "chat-storage-desktop-batch-clear-e2e"),
    GateSpec("CSG-G07", "chat-storage-mobile-batch-clear-e2e"),
    GateSpec("CSG-G07-regression", "chat-native-current-profile-two-client-e2e"),
    GateSpec("CSG-G07-regression", "mobile-simulator-chat-contacts-e2e"),
    GateSpec("CSG-G07-release", "desktop-release-build"),
    GateSpec("CSG-G07-release", "mobile-native-build"),
    GateSpec("CSG-G07-infra", "acceptance-infra-validation"),
)


@dataclass(frozen=True)
class BatchAggregate:
    source: dict[str, str]
    gates: tuple[GateResult, ...]

    @property
    def passed(self) -> bool:
        return (
            self.source.get("workspaceDigest") == "clean"
            and all(getattr(gate, "status", "") == "PASS" for gate in self.gates)
        )


class ChatStorageBatchClearAggregateGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "CSG-BATCH-03"
    bom = ("CSG-G07",)
    spec = (
        "docs/architecture/chat-storage-governance/acceptance-matrix.md",
        "docs/architecture/chat-storage-governance/decisions.md",
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
        aggregate = BatchAggregate(
            source=self.expected_source,
            gates=tuple(
                check_gate(
                    self.store,
                    spec,
                    expected_source=self.expected_source,
                )
                for spec in PRECEDING_GATES
            ),
        )
        for gate in aggregate.gates:
            self.report.add_assertion(
                f"{gate.acceptance_id}-{gate.gate_id}",
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
                "gates": [
                    {
                        "acceptanceId": gate.acceptance_id,
                        "gateId": gate.gate_id,
                        "runId": gate.run_id,
                        "status": gate.status,
                        "detail": gate.detail,
                    }
                    for gate in aggregate.gates
                ],
            }
        )
        if not aggregate.passed:
            raise GateError(
                "Chat storage batch-clear aggregate is incomplete: "
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
    return ChatStorageBatchClearAggregateGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
