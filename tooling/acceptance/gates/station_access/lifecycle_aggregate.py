#!/usr/bin/env python3
"""Aggregate current-source Station Access proof."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from tooling.acceptance.core import (
    AcceptanceGate,
    EvidenceError,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)


GATE_ID = "station-access-lifecycle-aggregate-e2e"
REPORT_RELATIVE_PATH = f"reports/{GATE_ID}.json"


@dataclass(frozen=True)
class GateSpec:
    acceptance_id: str
    gate_id: str


PRECEDING_GATES: tuple[GateSpec, ...] = (
    GateSpec("SAL-G04", "development-workflow-control-plane"),
    GateSpec("SAL-G00", "proto-build"),
    GateSpec("SAL-G00", "station-api-ownership"),
    GateSpec("SAL-G00", "station-access-capability-contract"),
    GateSpec("SAL-G01", "station-access-auth-e2e"),
    GateSpec("SAL-G02", "station-access-scope-isolation-e2e"),
    GateSpec("SAL-G03", "station-federation-unit"),
    GateSpec("SAL-G03", "station-access-federation-boundary-e2e"),
    GateSpec("SAL-G04", "mobile-hard-cut-static"),
    GateSpec("SAL-G04", "mobile-simulator-platform-e2e"),
    GateSpec("SAL-G04", "station-access-zero-legacy-e2e"),
    GateSpec("SAL-G04", "desktop-release-build"),
    GateSpec("SAL-G04", "mobile-native-build"),
)


@dataclass
class GateResult:
    acceptance_id: str
    gate_id: str
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
        manifest = store.latest(spec.gate_id)
    except EvidenceError as error:
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
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
            run_id=run_id if isinstance(run_id, str) else None,
            status="ERROR",
            detail="authoritative latest manifest identity is invalid",
        )
    if manifest.get("source") != expected_source:
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="STALE",
            detail="latest evidence source does not match aggregate source",
        )

    result = manifest.get("result")
    expected = {
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
    }
    if (
        not isinstance(result, dict)
        or {key: result.get(key) for key in expected} != expected
        or result.get("secretScan", {}).get("status") != "passed"
        or manifest.get("redaction", {}).get("status") != "passed"
    ):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="FAIL",
            detail="latest result is not passed/DONE/PROVEN with clean evidence",
        )
    return GateResult(
        acceptance_id=spec.acceptance_id,
        gate_id=spec.gate_id,
        run_id=run_id,
        status="PASS",
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
        "phase": "SAL-03",
        "bom": ["SAL-G00", "SAL-G01", "SAL-G02", "SAL-G03", "SAL-G04"],
        "spec": [
            "docs/architecture/station-access-lifecycle/acceptance-matrix.md",
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


class StationAccessLifecycleAggregateGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-03"
    bom = ("SAL-G00", "SAL-G01", "SAL-G02", "SAL-G03", "SAL-G04")
    report_path = (
        REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
    )
    spec = (
        "docs/architecture/station-access-lifecycle/acceptance-matrix.md",
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
                "Station Access aggregate is incomplete: "
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
    return StationAccessLifecycleAggregateGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
