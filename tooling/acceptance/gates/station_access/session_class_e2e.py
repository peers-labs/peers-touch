#!/usr/bin/env python3
"""Aggregate exact-source native proof for Station Access Session classes."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    EvidenceError,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)
from tooling.acceptance.station_access_evidence import (
    AggregateResult as PrerequisiteAggregateResult,
    GateResult, GateSpec, check_gate as check_formal_gate,
)


GATE_ID = "station-access-session-class-e2e"
CURRENT_RESULTS_ENV = "PT_ACCEPTANCE_CURRENT_RESULTS"


PRECEDING_GATES: tuple[GateSpec, ...] = (
    GateSpec("SAL-G08", "chat-native-multi-device-e2e"),
    GateSpec(
        "SAL-G08",
        "chat-lifecycle-mixed-client-multi-device-e2e",
    ),
    GateSpec("SAL-G08", "mobile-simulator-station-lifecycle-e2e"),
)


@dataclass
class AggregateResult(PrerequisiteAggregateResult):
    proof_status: str = "PROVEN"


def check_gate(
    store: EvidenceStore,
    spec: GateSpec,
    *,
    expected_source: dict[str, str],
    current_result: dict[str, Any] | None = None,
    current_results_authoritative: bool = False,
) -> GateResult:
    if current_results_authoritative and current_result is None:
        return GateResult(spec.acceptance_id, spec.gate_id, None, "MISSING")
    if (
        current_result is None
        or current_result.get("artifactKind") != "development-functional-result"
    ):
        return check_formal_gate(store, spec, expected_source=expected_source)
    try:
        reference = ArtifactRef.from_dict(current_result["developmentManifest"])
        if reference.workspace_id != store.workspace_id:
            raise ValueError("development manifest belongs to another workspace")
        manifest = store.read_run_manifest(
            reference, manifest_sha256=reference.sha256, expected_gate_id=spec.gate_id,
        )
    except (EvidenceError, KeyError, TypeError, ValueError, OSError):
        return GateResult(
            spec.acceptance_id, spec.gate_id, None, "ERROR",
            "original development manifest or complete inventory is invalid",
        )
    run_id = reference.run_id
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
            detail="original development evidence source does not match aggregate source",
        )

    result = manifest.get("result")
    if (
        not isinstance(result, dict)
        or result.get("status") != "passed"
        or result.get("verificationClass") != "FUNCTIONAL_CHECK"
        or result.get("cleanupStatus") not in {"passed", "not-required"}
        or current_result.get("status") != result["status"]
        or current_result.get("cleanupStatus") != result["cleanupStatus"]
        or current_result.get("developmentRunId") != run_id
    ):
        return GateResult(
            acceptance_id=spec.acceptance_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="FAIL",
            detail="original development functional result or cleanup did not pass",
        )
    return GateResult(
        acceptance_id=spec.acceptance_id,
        gate_id=spec.gate_id,
        run_id=run_id,
        status="PASS",
        run_manifest=reference.to_dict(),
    )


def load_current_results(
    raw: str,
    *,
    expected_source: dict[str, str],
) -> tuple[dict[str, dict[str, Any]] | None, str]:
    if not raw:
        return None, "PROVEN"
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError as error:
        raise GateError("current aggregate results are malformed") from error
    if (
        not isinstance(envelope, dict)
        or set(envelope) != {"source", "results"}
        or envelope.get("source") != expected_source
        or not isinstance(envelope.get("results"), list)
    ):
        raise GateError(
            "current aggregate results do not match the exact source"
        )

    results: dict[str, dict[str, Any]] = {}
    result_modes: set[str] = set()
    for value in envelope["results"]:
        if not isinstance(value, dict):
            raise GateError("current aggregate contains a malformed result")
        gate_id = value.get("id")
        if not isinstance(gate_id, str) or not gate_id:
            raise GateError("current aggregate result has no Gate identity")
        if gate_id in results:
            raise GateError(
                f"current aggregate repeats Gate {gate_id!r}"
            )
        results[gate_id] = value
        result_modes.add(
            "development"
            if value.get("artifactKind") == "development-functional-result"
            else "acceptance"
        )
    if len(result_modes) > 1:
        raise GateError("current aggregate mixes development and formal results")
    proof_status = (
        "NOT_APPLICABLE" if result_modes == {"development"} else "PROVEN"
    )
    return results, proof_status


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
        "proofStatus": (
            aggregate.proof_status if aggregate.passed else "UNPROVEN"
        ),
        "phase": "SAL-G08",
        "bom": ["SAL-G08"],
        "spec": [
            "docs/architecture/platform/station/access/acceptance-matrix.md",
            "docs/architecture/platform/station/access/experience-contract.md",
        ],
        "sampleEmissionAllowed": (
            aggregate.passed and aggregate.proof_status == "PROVEN"
        ),
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


class StationAccessSessionClassGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-G08"
    bom = ("SAL-G08",)
    report_path = (
        REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
    )
    spec = (
        "docs/architecture/platform/station/access/acceptance-matrix.md",
        "docs/architecture/platform/station/access/experience-contract.md",
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
        current_results, proof_status = load_current_results(
            os.environ.get(CURRENT_RESULTS_ENV, ""),
            expected_source=self.expected_source,
        )
        aggregate = AggregateResult(
            source=self.expected_source,
            proof_status=proof_status,
            gates=[
                check_gate(
                    self.store,
                    spec,
                    expected_source=self.expected_source,
                    current_result=(
                        None
                        if current_results is None
                        else current_results.get(spec.gate_id)
                    ),
                    current_results_authoritative=(
                        current_results is not None
                    ),
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
                "Station Access Session class proof is incomplete: "
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
    return StationAccessSessionClassGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
