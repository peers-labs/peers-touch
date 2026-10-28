#!/usr/bin/env python3
"""CCU aggregate gate: verify all preceding CCU gates passed.

Final aggregate gate for the Chat Capability Unification (CCU-07) project.
Reads the Runner's original prerequisite manifests, requires complete
current-source proof and cleanup, and emits its own immutable aggregate report.

GATE_ID: chat-lifecycle-ccu-aggregate-e2e
"""

from __future__ import annotations

import sys
from dataclasses import asdict
from pathlib import Path

from tooling.acceptance.core import (
    ArtifactSession,
    EvidenceStore,
    source_identity,
)
from tooling.acceptance.station_access_evidence import (
    AggregateResult, GateSpec, check_gate,
)

REPO_ROOT = Path(__file__).resolve().parents[4]

GATE_ID = "chat-lifecycle-ccu-aggregate-e2e"
REPORT_RELATIVE_PATH = f"reports/{GATE_ID}.json"

# ---------------------------------------------------------------------------
# Preceding CCU gates
# ---------------------------------------------------------------------------

PRECEDING_GATES: tuple[GateSpec, ...] = (
    GateSpec("CHAT-G15", "messaging-platform-contract"),
    GateSpec("CHAT-G16", "chat-lifecycle-mixed-client-same-station-e2e"),
    GateSpec("CHAT-G17", "chat-lifecycle-mixed-client-cross-station-e2e"),
    GateSpec("CHAT-G18", "chat-lifecycle-mixed-client-multi-device-e2e"),
    GateSpec("CHAT-G19", "chat-lifecycle-call-resolution-e2e"),
    GateSpec("CHAT-G20", "chat-lifecycle-mixed-client-group-mls-e2e"),
    GateSpec("CHAT-G21", "chat-lifecycle-tree-zero-reference-e2e"),
)


# ---------------------------------------------------------------------------
# Report writing
# ---------------------------------------------------------------------------

def build_report(aggregate: AggregateResult) -> dict[str, object]:
    if aggregate.passed:
        overall_status = "PASS"
    elif aggregate.unproven:
        overall_status = "UNPROVEN"
    else:
        overall_status = "FAIL"

    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": GATE_ID,
        "gate": GATE_ID,
        "status": overall_status,
        "completionStatus": "DONE" if aggregate.passed else "PARTIAL",
        "proofStatus": "PROVEN" if aggregate.passed else "UNPROVEN",
        "phase": "CCU-W07",
        "bom": [
            "CHAT-G15",
            "CHAT-G16",
            "CHAT-G17",
            "CHAT-G18",
            "CHAT-G19",
            "CHAT-G20",
            "CHAT-G21",
            "CHAT-G22",
        ],
        "spec": [
            "docs/architecture/domains/chat/lifecycle/acceptance-matrix.md",
            "docs/architecture/domains/chat/lifecycle/decisions.md#ccu-d05",
        ],
        "sampleEmissionAllowed": aggregate.passed,
        "source": aggregate.source,
        "gateCount": len(aggregate.gates),
        "passedCount": sum(1 for g in aggregate.gates if g.status == "PASS"),
        "failedCount": sum(1 for g in aggregate.gates if g.status == "FAIL"),
        "missingCount": sum(1 for g in aggregate.gates if g.status == "MISSING"),
        "staleCount": sum(1 for g in aggregate.gates if g.status == "STALE"),
        "errorCount": sum(1 for g in aggregate.gates if g.status == "ERROR"),
        "gates": [asdict(g) for g in aggregate.gates],
        "assertions": [
            {
                "name": f"{g.acceptance_id}-{g.gate_id}",
                "passed": g.status == "PASS",
                "detail": g.detail or g.status,
            }
            for g in aggregate.gates
        ],
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    expected_source = source_identity(REPO_ROOT)
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    aggregate = AggregateResult(source=expected_source)

    for spec in PRECEDING_GATES:
        aggregate.gates.append(
            check_gate(
                store,
                spec,
                expected_source=expected_source,
            )
        )

    report = build_report(aggregate)
    with ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=GATE_ID,
        source=expected_source,
    ) as artifacts:
        artifacts.write_json(
            REPORT_RELATIVE_PATH,
            report,
            role="report",
        )
        artifacts.complete(
            status="passed" if aggregate.passed else "failed",
            completion_status=(
                "DONE" if aggregate.passed else "PARTIAL"
            ),
            proof_status=(
                "PROVEN" if aggregate.passed else "UNPROVEN"
            ),
        )

    if aggregate.passed:
        print(
            f"PASS: {GATE_ID} -- CHAT-G15-G21 all have current "
            f"exact-source PROVEN evidence ({len(aggregate.gates)} passed)"
        )
        return 0

    if aggregate.unproven:
        print(
            f"UNPROVEN: {GATE_ID} -- one or more required Gates lack "
            "current exact-source PROVEN evidence:"
        )
    else:
        print(f"FAIL: {GATE_ID} -- one or more CCU gates did not pass:")

    for g in aggregate.gates:
        marker = "OK" if g.status == "PASS" else g.status
        suffix = f" -- {g.detail}" if g.detail else ""
        print(
            f"  [{marker}] {g.acceptance_id} "
            f"({g.gate_id}){suffix}"
        )

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
