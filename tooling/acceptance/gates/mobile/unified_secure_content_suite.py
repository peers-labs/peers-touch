#!/usr/bin/env python3
"""Validate source-bound Desktop/iOS/Android Secure Content Suite evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPO_ROOT,
    RuntimeReuseContract,
    SuiteRuntimeError,
    source_identity,
    validate_suite_runtime_report,
    write_current_artifact,
)


GATE_ID = "unified-client-secure-content-e2e"
REQUIRED_RUNTIME_CELLS = (
    "desktop-macos-native",
    "mobile-ios-native",
    "mobile-android-native",
)
REQUIRED_SCENARIOS = (
    "secure-content-desktop",
    "secure-content-ios",
    "secure-content-android",
)
RUNTIME_REUSE_CONTRACT = RuntimeReuseContract(
    entry_check_id="uca05-social-functional",
    scenario_ids=REQUIRED_SCENARIOS,
    max_provisioning_runs=1,
    max_client_launches=3,
    min_warm_reuse_rate=0.66,
    require_attach_only_scenarios=True,
    require_receiver_visible_proof=True,
    allow_client_replacement=False,
)
SCENARIO_FIELDS = {
    "publishPrepared",
    "receiverVisible",
    "stationPlaintextAbsent",
    "restartRecovered",
    "revocationConverged",
    "objectTransferResumed",
}


def parse_runtime_cells(value: str) -> tuple[str, ...]:
    cells = tuple(part.strip() for part in value.split(",") if part.strip())
    if cells != REQUIRED_RUNTIME_CELLS:
        raise GateError(
            "Secure Content Suite runtime cells must be exactly "
            + ",".join(REQUIRED_RUNTIME_CELLS)
        )
    return cells


def validate_runtime_evidence(
    path: Path,
    *,
    expected_source: dict[str, str],
    runtime_cells: tuple[str, ...],
) -> dict[str, object]:
    if not path.is_file():
        raise GateError(
            "UNPROVEN: current-source Secure Content runtime evidence is unavailable"
        )
    value = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(value, dict)
        or set(value)
        != {
            "artifactKind",
            "source",
            "runtimeCells",
            "suiteRuntime",
            "scenarios",
        }
    ):
        raise GateError("Secure Content runtime evidence schema is invalid")
    if (
        value["artifactKind"] != "unified-client-secure-content-runtime-evidence"
        or value["source"] != expected_source
        or value["runtimeCells"] != list(runtime_cells)
    ):
        raise GateError(
            "UNPROVEN: Secure Content runtime evidence is stale or targets other cells"
        )
    try:
        suite = validate_suite_runtime_report(
            value["suiteRuntime"],
            expected_contract=RUNTIME_REUSE_CONTRACT,
        )
    except SuiteRuntimeError as error:
        raise GateError(str(error)) from error
    expected_digest = (
        expected_source["commit"]
        if expected_source["workspaceDigest"] == "clean"
        else expected_source["workspaceDigest"].removeprefix("sha256:")
    )
    if suite["sourceDigest"] != expected_digest:
        raise GateError("UNPROVEN: Secure Content Suite source digest is stale")

    scenarios = value["scenarios"]
    if not isinstance(scenarios, dict) or set(scenarios) != set(REQUIRED_SCENARIOS):
        raise GateError("Secure Content runtime scenario evidence is incomplete")
    for scenario_id in REQUIRED_SCENARIOS:
        scenario = scenarios[scenario_id]
        if (
            not isinstance(scenario, dict)
            or set(scenario) != SCENARIO_FIELDS
            or any(item is not True for item in scenario.values())
        ):
            raise GateError(
                "Secure Content runtime scenario lacks lifecycle proof: "
                + scenario_id
            )
    return value


class UnifiedSecureContentSuiteGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-05"
    bom = ("UCA-20261017", "SC-D30", "secure-content-operation-v1")
    spec = (
        "docs/architecture/shared/security/secure-content/decisions.md",
        "docs/architecture/shared/security/secure-content/operations.md",
    )

    def __init__(
        self,
        *,
        runtime_cells: tuple[str, ...],
        reuse_suite_runtime: bool,
        runtime_evidence: Path | None,
    ) -> None:
        if runtime_cells != REQUIRED_RUNTIME_CELLS:
            raise GateError("Secure Content Suite runtime-cell contract is invalid")
        if not reuse_suite_runtime:
            raise GateError("Secure Content Suite must reuse one Suite Runtime")
        self.runtime_cells = runtime_cells
        self.runtime_evidence = runtime_evidence
        super().__init__()

    def run(self) -> dict[str, object]:
        if self.runtime_evidence is None:
            self.report.runtime.update(
                {
                    "status": "UNPROVEN",
                    "runtimeCells": list(self.runtime_cells),
                    "cellProof": {
                        cell: "UNPROVEN" for cell in self.runtime_cells
                    },
                    "physicalAndroidPending": True,
                }
            )
            raise GateError(
                "UNPROVEN: current-source Desktop, signed iOS and physical "
                "Android Secure Content lifecycle evidence is unavailable"
            )
        source = source_identity(REPO_ROOT)
        evidence = validate_runtime_evidence(
            self.runtime_evidence,
            expected_source=source,
            runtime_cells=self.runtime_cells,
        )
        write_current_artifact(
            "reports/suite-runtime.json",
            (json.dumps(evidence["suiteRuntime"], sort_keys=True) + "\n").encode(),
            repo_root=REPO_ROOT,
        )
        self.report.runtime.update(
            {
                "runtimeCells": list(self.runtime_cells),
                "cellProof": {
                    cell: "PASS" for cell in self.runtime_cells
                },
                "suiteRuntimeId": evidence["suiteRuntime"]["suiteRuntimeId"],
            }
        )
        self.assert_condition(
            "secure_content_three_release_targets",
            True,
            "Desktop, signed iOS and physical Android cells are current-source",
        )
        self.assert_condition(
            "secure_content_full_lifecycle",
            True,
            "publish, receiver, restart, revocation and object resume are proven",
        )
        return {
            "runtimeCells": list(self.runtime_cells),
            "scenarioIds": list(REQUIRED_SCENARIOS),
            "suiteRuntime": evidence["suiteRuntime"],
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--runtime-cells",
        default=",".join(REQUIRED_RUNTIME_CELLS),
    )
    parser.add_argument("--reuse-suite-runtime", action="store_true")
    parser.add_argument("--runtime-evidence", type=Path)
    arguments = parser.parse_args()
    cells = parse_runtime_cells(arguments.runtime_cells)
    return UnifiedSecureContentSuiteGate(
        runtime_cells=cells,
        reuse_suite_runtime=arguments.reuse_suite_runtime,
        runtime_evidence=arguments.runtime_evidence,
    ).execute()


if __name__ == "__main__":
    raise SystemExit(main())
