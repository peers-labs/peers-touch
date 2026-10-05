#!/usr/bin/env python3
"""CCU aggregate gate: verify all preceding CCU gates passed.

Final aggregate gate for the Chat Capability Unification (CCU-07) project.
Reads every required Gate's authoritative latest Evidence Store manifest,
requires clean exact-source proof, and emits its own immutable aggregate
report.

GATE_ID: chat-lifecycle-ccu-aggregate-e2e
"""

from __future__ import annotations

import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

from tooling.acceptance.core import (
    ArtifactSession,
    EvidenceError,
    EvidenceStore,
    source_identity,
)

REPO_ROOT = Path(__file__).resolve().parents[4]

GATE_ID = "chat-lifecycle-ccu-aggregate-e2e"
REPORT_RELATIVE_PATH = f"reports/{GATE_ID}.json"

# ---------------------------------------------------------------------------
# Preceding CCU gates
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class GateSpec:
    acceptance_id: str
    gate_id: str


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
# Data model
# ---------------------------------------------------------------------------

@dataclass
class GateResult:
    acceptance_id: str
    gate_id: str
    run_id: str | None
    status: str  # "PASS", "FAIL", "MISSING", "STALE", "ERROR"
    detail: str = ""


@dataclass
class AggregateResult:
    source: dict[str, str]
    gates: list[GateResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return (
            self.source.get("workspaceDigest") == "clean"
            and all(g.status == "PASS" for g in self.gates)
        )

    @property
    def unproven(self) -> bool:
        return (
            self.source.get("workspaceDigest") != "clean"
            or any(g.status in {"MISSING", "STALE", "ERROR"} for g in self.gates)
        )


# ---------------------------------------------------------------------------
# Report loading
# ---------------------------------------------------------------------------

def check_gate(
    store: EvidenceStore,
    spec: GateSpec,
    *,
    expected_source: dict[str, str],
) -> GateResult:
    """Check one required Gate's immutable authoritative latest manifest."""
    try:
        manifest = store.latest(spec.gate_id)
    except EvidenceError as error:
        status = (
            "MISSING"
            if "latest pointer is unavailable" in str(error)
            else "ERROR"
        )
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=None,
            status=status,
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
            run_id=run_id if isinstance(run_id, str) else None,
            status="ERROR",
            detail="authoritative latest manifest identity is invalid",
        )

    observed_source = manifest.get("source")
    if observed_source != expected_source:
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="STALE",
            detail=(
                "latest evidence source does not match the aggregate source: "
                f"observed={observed_source!r}"
            ),
        )

    result = manifest.get("result")
    if not isinstance(result, dict):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="ERROR",
            detail="authoritative latest manifest has no result object",
        )

    expected_result = {
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
    }
    observed_result = {
        key: result.get(key)
        for key in expected_result
    }
    secret_scan = result.get("secretScan")
    if (
        observed_result != expected_result
        or not isinstance(secret_scan, dict)
        or secret_scan.get("status") != "passed"
        or manifest.get("redaction", {}).get("status") != "passed"
    ):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="FAIL",
            detail=(
                "authoritative latest result is not passed/DONE/PROVEN with "
                f"clean evidence: result={observed_result!r}"
            ),
        )

    return GateResult(
        acceptance_id=spec.acceptance_id,
        gate_id=spec.gate_id,
        run_id=run_id,
        status="PASS",
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
