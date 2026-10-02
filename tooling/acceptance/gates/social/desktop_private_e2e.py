#!/usr/bin/env python3
"""Formal Native Desktop Acceptance gate for Social Private Moments."""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "social-private-desktop-e2e"
REQUIRED_SCENARIOS = (
    "SOC-SEC-AS01",
    "SOC-SEC-AS02",
    "SOC-SEC-AS03",
    "SOC-SEC-AS04",
    "SOC-SEC-AS05",
    "SOC-SEC-AS06",
    "SOC-SEC-AS07",
    "SOC-SEC-AS08",
    "SOC-SEC-AS09",
    "SOC-SEC-AS10",
    "SOC-SEC-AS12",
    "SOC-SEC-AS13",
    "SOC-SEC-AS15",
    "SOC-SEC-AS16",
)
EXPLICITLY_UNPROVEN_SCENARIOS = (
    "SOC-SEC-AS11",
    "SOC-SEC-AS14",
)


def _parse_owner_output(stdout: str) -> dict[str, Any]:
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        raise GateError("Social Desktop runtime owner returned no result")
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError as error:
        raise GateError(
            "Social Desktop runtime owner returned invalid JSON"
        ) from error
    if not isinstance(payload, dict):
        raise GateError("Social Desktop runtime owner result must be an object")
    return payload


def _validate_owner_result(payload: Mapping[str, Any]) -> tuple[Path, list[Path]]:
    if (
        payload.get("status") != "FUNCTIONAL_PASS"
        or payload.get("proofState") != "UNPROVEN"
    ):
        raise GateError("Social Desktop runtime owner did not functionally pass")

    scenario_results = payload.get("scenarioResults")
    if not isinstance(scenario_results, Mapping):
        raise GateError("Social Desktop scenario results are missing")
    if tuple(sorted(scenario_results)) != tuple(sorted(REQUIRED_SCENARIOS)):
        raise GateError("Social Desktop scenario result set is incomplete")
    failed = [
        scenario_id
        for scenario_id in REQUIRED_SCENARIOS
        if scenario_results.get(scenario_id) != "PASS"
    ]
    if failed:
        raise GateError(f"Social Desktop scenarios did not pass: {failed}")

    if tuple(payload.get("unprovenScenarios") or ()) != (
        EXPLICITLY_UNPROVEN_SCENARIOS
    ):
        raise GateError("Browser and Mobile non-claims are missing or changed")

    reuse = payload.get("resourceReuse")
    if not isinstance(reuse, Mapping):
        raise GateError("Social Desktop resource reuse evidence is missing")
    if (
        reuse.get("provisioningRuns") != 1
        or reuse.get("maxConcurrentNativeClients", 99) > 3
        or reuse.get("newAccountRegistrations") != 0
        or reuse.get("stationBuilds") != 0
        or reuse.get("stationDeployments") != 0
        or reuse.get("desktopBuilds") != 0
        or reuse.get("clientReplacements") != ["bob"]
    ):
        raise GateError("Social Desktop Suite exceeded its resource budget")

    suite_report = Path(str(payload.get("suiteRuntimeReport") or ""))
    if not suite_report.is_file():
        raise GateError("Social Desktop Suite Runtime report is missing")
    supporting = payload.get("supportingArtifacts") or []
    if (
        not isinstance(supporting, Sequence)
        or isinstance(supporting, (str, bytes))
    ):
        raise GateError("Social Desktop supporting artifact list is invalid")
    artifact_paths = [Path(str(path)) for path in supporting]
    if any(not path.is_file() for path in artifact_paths):
        raise GateError("Social Desktop supporting artifact is missing")
    return suite_report, artifact_paths


class SocialPrivateDesktopGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "Social Private Moments Desktop"
    bom = (
        "SOC-SEC-RC01",
        "SOC-SEC-RC03",
        "SOC-SEC-RC04",
        "SOC-SEC-RC05",
        "SOC-SEC-RC06",
    )
    spec = (
        "docs/architecture/social/product-definition.md",
        "docs/architecture/social/experience-contract.md",
        "docs/architecture/social/product-state-model.md",
        "docs/architecture/social/acceptance-matrix.md",
    )

    def run(self) -> dict[str, Any]:
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "tooling.development.secure_content.runtime_owner",
                "run-social-desktop-acceptance-suite",
                "--profiles",
                "four,fiveArm",
                "--slot",
                "5",
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=8800,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stdout + completed.stderr)[-6000:]
            raise GateError(f"Social Desktop runtime owner failed: {detail}")

        payload = _parse_owner_output(completed.stdout)
        suite_report, supporting = _validate_owner_result(payload)
        self.report.add_evidence_file("suite-runtime", suite_report)
        for index, path in enumerate(supporting):
            self.report.add_evidence_file(
                f"social-supporting-{index + 1}",
                path,
            )

        for scenario_id in REQUIRED_SCENARIOS:
            self.assert_condition(
                scenario_id,
                payload["scenarioResults"][scenario_id] == "PASS",
            )
        self.assert_condition(
            "desktop-only-non-claims",
            payload["unprovenScenarios"]
            == list(EXPLICITLY_UNPROVEN_SCENARIOS),
        )
        return {
            "runtimeCell": "social-private-desktop-native",
            "scenarioResults": payload["scenarioResults"],
            "resourceReuse": payload["resourceReuse"],
            "unprovenScenarios": payload["unprovenScenarios"],
            "suiteRuntimeReportDigest": payload.get(
                "suiteRuntimeReportDigest"
            ),
        }


def main() -> int:
    return SocialPrivateDesktopGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
