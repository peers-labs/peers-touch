#!/usr/bin/env python3
"""Aggregate exact-source unified-client evidence without provisioning."""

from __future__ import annotations

import hashlib
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    EvidenceError,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    SuiteRuntimeError,
    source_identity,
    validate_suite_runtime_report,
)


GATE_ID = "unified-client-architecture-aggregate"
OUTCOME_COMPARISON_PATH = (
    REPO_ROOT
    / "docs"
    / "architecture"
    / "platform"
    / "client"
    / "cross-client-runtime"
    / "execution-plans"
    / "20261017-unified-client-architecture"
    / "outcome-comparison.md"
)
BASELINE_CHECKS: tuple[tuple[str, ...], ...] = (
    (
        "pnpm",
        "--dir",
        "apps/mobile",
        "run",
        "check:native-platforms",
    ),
    (
        "node",
        "tooling/scripts/architecture/module-governance.mjs",
        "validate",
    ),
)


@dataclass(frozen=True)
class GateSpec:
    task_id: str
    gate_id: str
    runtime_cells: tuple[str, ...] = ()
    requires_suite_runtime: bool = False


CHILD_GATES: tuple[GateSpec, ...] = (
    GateSpec(
        "UCA-02",
        "unified-client-android-host-e2e",
        ("mobile-android-native",),
        True,
    ),
    GateSpec(
        "UCA-03",
        "unified-client-ios-host-e2e",
        ("mobile-ios-native",),
        True,
    ),
    GateSpec("UCA-04A", "unified-client-messaging-core-contract"),
    GateSpec(
        "UCA-04",
        "unified-client-messaging-e2e",
        (
            "desktop-macos-native",
            "mobile-ios-native",
            "mobile-android-native",
        ),
        True,
    ),
    GateSpec("UCA-04", "messaging-owner-hard-cut-zero"),
    GateSpec("UCA-05A", "secure-content-portable-core"),
    GateSpec(
        "UCA-05",
        "unified-client-secure-content-e2e",
        (
            "desktop-macos-native",
            "mobile-ios-native",
            "mobile-android-native",
        ),
        True,
    ),
    GateSpec("UCA-05", "secure-content-owner-hard-cut-zero"),
    GateSpec("UCA-06", "unified-client-shared-semantics"),
)


@dataclass
class BaselineResult:
    command: str
    status: str
    detail: str = ""


@dataclass
class ChildResult:
    task_id: str
    gate_id: str
    run_id: str | None
    status: str
    runtime_cells: tuple[str, ...] = ()
    suite_runtime_digest: str | None = None
    detail: str = ""


@dataclass
class AggregateResult:
    source: dict[str, str]
    outcome_comparison_sha256: str
    baseline: list[BaselineResult] = field(default_factory=list)
    children: list[ChildResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return (
            all(item.status == "PASS" for item in self.baseline)
            and all(item.status == "PASS" for item in self.children)
        )

    @property
    def unproven(self) -> bool:
        return any(
            item.status in {"MISSING", "STALE", "ERROR", "UNPROVEN"}
            for item in self.children
        )


Runner = Callable[..., subprocess.CompletedProcess[str]]


def run_baseline_checks(
    *,
    runner: Runner = subprocess.run,
) -> list[BaselineResult]:
    results: list[BaselineResult] = []
    for command in BASELINE_CHECKS:
        completed = runner(
            list(command),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        detail = (completed.stderr or completed.stdout).strip()
        results.append(
            BaselineResult(
                command=" ".join(command),
                status="PASS" if completed.returncode == 0 else "FAIL",
                detail="" if completed.returncode == 0 else detail,
            )
        )
    return results


def check_child(
    store: EvidenceStore,
    spec: GateSpec,
    *,
    expected_source: dict[str, str],
) -> ChildResult:
    try:
        if len(spec.runtime_cells) == 1:
            manifest = store.latest(spec.gate_id, runtime_cell=spec.runtime_cells[0])
        else:
            manifest = store.latest(spec.gate_id)
    except EvidenceError as error:
        return ChildResult(
            task_id=spec.task_id,
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
        return ChildResult(
            task_id=spec.task_id,
            gate_id=spec.gate_id,
            run_id=run_id if isinstance(run_id, str) else None,
            status="ERROR",
            detail="authoritative latest manifest identity is invalid",
        )
    if manifest.get("source") != expected_source:
        return ChildResult(
            task_id=spec.task_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="STALE",
            detail="latest evidence source does not match aggregate source",
        )

    result = manifest.get("result")
    if (
        isinstance(result, dict)
        and result.get("proofStatus") == "UNPROVEN"
        and result.get("completionStatus") in {"PARTIAL", "BLOCKED"}
    ):
        return ChildResult(
            task_id=spec.task_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="UNPROVEN",
            runtime_cells=spec.runtime_cells,
            detail=str(
                result.get("blockedReason")
                or result.get("reason")
                or "required runtime proof is unavailable"
            ),
        )
    if (
        not isinstance(result, dict)
        or result.get("status") != "passed"
        or result.get("completionStatus") != "DONE"
        or result.get("proofStatus") != "PROVEN"
        or result.get("secretScan", {}).get("status") != "passed"
        or manifest.get("redaction", {}).get("status") != "passed"
    ):
        return ChildResult(
            task_id=spec.task_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="FAIL",
            detail="latest result is not passed/DONE/PROVEN with clean evidence",
        )

    runtime = manifest.get("runtime")
    observed_cells = (
        runtime.get("runtimeCells")
        if isinstance(runtime, dict)
        else None
    )
    if spec.runtime_cells and observed_cells != list(spec.runtime_cells):
        return ChildResult(
            task_id=spec.task_id,
            gate_id=spec.gate_id,
            run_id=run_id,
            status="FAIL",
            detail=(
                "runtime cells do not match the required release-target cells"
            ),
        )

    suite_runtime_digest = None
    if spec.requires_suite_runtime:
        suite_result = _validate_suite_runtime(
            store,
            manifest,
            expected_source=expected_source,
        )
        if isinstance(suite_result, str):
            return ChildResult(
                task_id=spec.task_id,
                gate_id=spec.gate_id,
                run_id=run_id,
                status="FAIL",
                runtime_cells=spec.runtime_cells,
                detail=suite_result,
            )
        suite_runtime_digest = suite_result["reportDigest"]

    return ChildResult(
        task_id=spec.task_id,
        gate_id=spec.gate_id,
        run_id=run_id,
        status="PASS",
        runtime_cells=spec.runtime_cells,
        suite_runtime_digest=suite_runtime_digest,
    )


def _validate_suite_runtime(
    store: EvidenceStore,
    manifest: dict[str, object],
    *,
    expected_source: dict[str, str],
) -> dict[str, object] | str:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        return "runtime Gate has no suite-runtime artifact"
    suite_reference = artifacts.get("suite-runtime") or artifacts.get(
        "reports/suite-runtime.json"
    )
    if suite_reference is None:
        return "runtime Gate has no suite-runtime artifact"
    try:
        reference = ArtifactRef.from_dict(suite_reference)
        report = store.read_json(reference)
        validated = validate_suite_runtime_report(report)
    except (EvidenceError, SuiteRuntimeError, ValueError) as error:
        return f"suite-runtime artifact is invalid: {error}"

    source_digest = (
        expected_source["commit"]
        if expected_source["workspaceDigest"] == "clean"
        else expected_source["workspaceDigest"].removeprefix("sha256:")
    )
    if validated.get("sourceDigest") != source_digest:
        return "suite-runtime source identity does not match aggregate source"
    return validated


def outcome_comparison_sha256(path: Path = OUTCOME_COMPARISON_PATH) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
        "status": status,
        "completionStatus": "DONE" if aggregate.passed else "PARTIAL",
        "proofStatus": "PROVEN" if aggregate.passed else "UNPROVEN",
        "source": aggregate.source,
        "outcomeComparisonSha256": aggregate.outcome_comparison_sha256,
        "baseline": [asdict(item) for item in aggregate.baseline],
        "children": [asdict(item) for item in aggregate.children],
        "assertions": [
            {
                "name": f"baseline-{index}",
                "passed": item.status == "PASS",
                "detail": item.detail or item.command,
            }
            for index, item in enumerate(aggregate.baseline, start=1)
        ]
        + [
            {
                "name": f"{item.task_id}-{item.gate_id}",
                "passed": item.status == "PASS",
                "detail": item.detail or item.status,
            }
            for item in aggregate.children
        ],
    }


class UnifiedClientArchitectureAggregateGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-08"
    bom = tuple(dict.fromkeys(spec.task_id for spec in CHILD_GATES))
    spec = (
        "docs/architecture/platform/client/cross-client-runtime/"
        "execution-plans/20261017-unified-client-architecture/plan.md",
        "docs/architecture/platform/client/cross-client-runtime/"
        "execution-plans/20261017-unified-client-architecture/"
        "outcome-comparison.md",
    )

    def __init__(
        self,
        *,
        store: EvidenceStore | None = None,
        expected_source: dict[str, str] | None = None,
        runner: Runner = subprocess.run,
    ) -> None:
        super().__init__()
        self.store = store or EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        self.expected_source = expected_source or source_identity(REPO_ROOT)
        self.runner = runner

    def run(self) -> dict[str, object]:
        aggregate = AggregateResult(
            source=self.expected_source,
            outcome_comparison_sha256=outcome_comparison_sha256(),
            baseline=run_baseline_checks(runner=self.runner),
            children=[
                check_child(
                    self.store,
                    spec,
                    expected_source=self.expected_source,
                )
                for spec in CHILD_GATES
            ],
        )
        report = build_report(aggregate)
        for assertion in report["assertions"]:
            self.report.add_assertion(
                assertion["name"],
                assertion["passed"],
                assertion["detail"],
            )
        self.report.runtime.update(report)
        if not aggregate.passed:
            failures = [
                f"{item.gate_id}={item.status}"
                for item in aggregate.children
                if item.status != "PASS"
            ]
            failures.extend(
                f"{item.command}={item.status}"
                for item in aggregate.baseline
                if item.status != "PASS"
            )
            raise GateError(
                "Unified client architecture aggregate is incomplete: "
                + ", ".join(failures)
            )
        return {
            "childGateCount": len(aggregate.children),
            "outcomeComparisonSha256": aggregate.outcome_comparison_sha256,
        }


def main() -> int:
    return UnifiedClientArchitectureAggregateGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
