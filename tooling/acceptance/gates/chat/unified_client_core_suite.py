#!/usr/bin/env python3
"""Validate source-bound Desktop/iOS/Android Messaging Suite evidence."""

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


GATE_ID = "unified-client-messaging-e2e"
REQUIRED_RUNTIME_CELLS = (
    "desktop-macos-native",
    "mobile-ios-native",
    "mobile-android-native",
)
REQUIRED_SCENARIOS = (
    "messaging-desktop-ios",
    "messaging-desktop-android",
    "messaging-multi-device",
)
RUNTIME_REUSE_CONTRACT = RuntimeReuseContract(
    entry_check_id="uca04-mixed-suite",
    scenario_ids=REQUIRED_SCENARIOS,
    max_provisioning_runs=1,
    max_client_launches=5,
    min_warm_reuse_rate=0.66,
    require_attach_only_scenarios=True,
    require_receiver_visible_proof=True,
    allow_client_replacement=False,
)


def parse_runtime_cells(value: str) -> tuple[str, ...]:
    cells = tuple(part.strip() for part in value.split(",") if part.strip())
    if cells != REQUIRED_RUNTIME_CELLS:
        raise GateError(
            "Messaging Suite runtime cells must be exactly "
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
            "UNPROVEN: current-source Messaging runtime evidence is unavailable"
        )
    value = json.loads(path.read_text(encoding="utf-8"))
    expected_fields = {
        "artifactKind",
        "source",
        "runtimeCells",
        "suiteRuntime",
        "scenarios",
    }
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise GateError("Messaging runtime evidence schema is invalid")
    if (
        value["artifactKind"]
        != "unified-client-messaging-runtime-evidence"
        or value["source"] != expected_source
        or value["runtimeCells"] != list(runtime_cells)
    ):
        raise GateError(
            "UNPROVEN: Messaging runtime evidence is stale or targets other cells"
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
        raise GateError("UNPROVEN: Suite Runtime source digest is stale")

    scenarios = value["scenarios"]
    if not isinstance(scenarios, dict) or set(scenarios) != set(REQUIRED_SCENARIOS):
        raise GateError("Messaging runtime scenario evidence is incomplete")
    for scenario_id in REQUIRED_SCENARIOS:
        scenario = scenarios[scenario_id]
        if (
            not isinstance(scenario, dict)
            or set(scenario)
            != {
                "senderProjection",
                "receiverProjection",
                "receiverVisible",
                "restartConverged",
                "receiptConverged",
            }
            or any(item is not True for item in scenario.values())
        ):
            raise GateError(
                f"Messaging runtime scenario is not receiver-proven: {scenario_id}"
            )
    return value


class UnifiedClientMessagingSuiteGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-04"
    bom = ("UCA-20261017", "MP-D16", "messaging-store-v1")
    spec = (
        "docs/architecture/domains/chat/messaging/decisions.md",
        "docs/architecture/domains/chat/messaging/integration.md",
    )

    def __init__(
        self,
        *,
        runtime_cells: tuple[str, ...],
        reuse_suite_runtime: bool,
        runtime_evidence: Path | None,
    ) -> None:
        if runtime_cells != REQUIRED_RUNTIME_CELLS:
            raise GateError("Messaging Suite runtime-cell contract is invalid")
        if not reuse_suite_runtime:
            raise GateError("Messaging Suite must reuse one Suite Runtime")
        self.runtime_cells = runtime_cells
        self.runtime_evidence = runtime_evidence
        super().__init__()

    def run(self) -> dict[str, object]:
        if self.runtime_evidence is None:
            self.report.runtime.update(
                {
                    "status": "UNPROVEN",
                    "runtimeCells": list(self.runtime_cells),
                    "physicalAndroidPending": True,
                }
            )
            raise GateError(
                "UNPROVEN: signed iOS and physical Android Messaging evidence is unavailable"
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
                "suiteRuntimeId": evidence["suiteRuntime"]["suiteRuntimeId"],
            }
        )
        self.assert_condition(
            "messaging_three_release_targets",
            True,
            "Desktop, signed iOS and physical Android cells are current-source",
        )
        self.assert_condition(
            "messaging_receiver_visible_convergence",
            True,
            "all reusable-Suite scenarios contain sender and receiver projections",
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
    return UnifiedClientMessagingSuiteGate(
        runtime_cells=cells,
        reuse_suite_runtime=arguments.reuse_suite_runtime,
        runtime_evidence=arguments.runtime_evidence,
    ).execute()


if __name__ == "__main__":
    raise SystemExit(main())
