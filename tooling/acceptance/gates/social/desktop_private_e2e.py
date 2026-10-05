#!/usr/bin/env python3
"""Formal same-Station Social proof attached to the CSS-09 Native Suite."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError

from .cross_station_support import (
    SourceCommand,
    attach_suite_evidence,
    load_suite_result,
    run_source_commands,
)


GATE_ID = "social-private-desktop-e2e"
SAME_STATION_SCENARIO = "same-station-regression"
HISTORICAL_SCENARIOS = ("SOC-SEC-AS12",)
EXPLICITLY_UNPROVEN_SCENARIOS = (
    "SOC-SEC-AS11",
    "SOC-SEC-AS14",
)
SOURCE_COMMANDS = (
    SourceCommand(
        name="viewer-envelope-and-prekey-source-check",
        argv=(
            "go",
            "test",
            "-count=1",
            "-run",
            (
                "^(TestPrivateContentServicePrepareSubmitReplay|"
                "TestPrivateContentServicePrepareSubmitComment|"
                "TestContentPreKeyDifferentPlansConsumeDistinctKeys)$"
            ),
            "./app/subserver/social/application",
            "./app/subserver/key_exchange",
        ),
        cwd="apps/station",
        timeout_seconds=900,
    ),
)


def _validate_attached_suite(
    payload: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    scenario_results = payload.get("scenarioResults")
    if not isinstance(scenario_results, Mapping):
        raise GateError("CSS-09 Social scenario results are missing")
    same_station = scenario_results.get(SAME_STATION_SCENARIO)
    if (
        not isinstance(same_station, Mapping)
        or same_station.get("status") != "PASS"
        or not same_station.get("evidenceRefs")
    ):
        raise GateError(
            "CSS-09 same-Station regression lacks receiver-visible evidence"
        )

    reuse = payload.get("resourceReuse")
    if not isinstance(reuse, Mapping):
        raise GateError("CSS-09 Social resource reuse evidence is missing")
    if (
        reuse.get("provisioningRuns") != 1
        or reuse.get("clientLaunches") != 3
        or reuse.get("maxConcurrentNativeClients", 99) > 2
        or reuse.get("newAccountRegistrations") != 3
        or reuse.get("stationBuilds") != 0
        or reuse.get("stationDeployments") != 0
        or reuse.get("desktopBuilds") != 0
        or reuse.get("clientReplacements") != ["bob2"]
        or reuse.get("fixtureOnlyClients") != ["eve"]
    ):
        raise GateError("CSS-09 Social Suite exceeded its resource budget")

    runtime_manifest = payload.get("runtimeManifest")
    if (
        not isinstance(runtime_manifest, Mapping)
        or runtime_manifest.get("state") != "FIXTURE_READY"
        or not runtime_manifest.get("runId")
    ):
        raise GateError("CSS-09 Social runtime manifest is incomplete")
    return dict(same_station), dict(reuse), dict(runtime_manifest)


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
        "docs/architecture/cross-station-social/execution-plans/"
        "20261003-native-private-social/plan.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, SOURCE_COMMANDS)
        result = load_suite_result()
        same_station, resource_reuse, runtime_manifest = (
            _validate_attached_suite(result.payload)
        )
        self.report.manifest = runtime_manifest
        attach_suite_evidence(self, result)

        self.assert_condition(
            SAME_STATION_SCENARIO,
            same_station["status"] == "PASS"
            and bool(same_station["evidenceRefs"]),
            "PASS with receiver-visible evidence",
        )
        self.assert_condition(
            "suite-runtime-cleanup",
            result.payload["cleanup"]["status"] == "CLEANED",
        )
        self.assert_condition(
            "suite-artifact-remains-non-self-proving",
            result.payload["proofState"] == "UNPROVEN",
        )
        return {
            "evidenceClass": "NATIVE_RECEIVER_PROOF",
            "suiteArtifactProofState": result.payload["proofState"],
            "runtimeCell": "cross-station-social-native",
            "controlCommit": result.payload["controlCommit"],
            "sourceCommit": result.payload["sourceCommit"],
            "scenarioResults": {
                SAME_STATION_SCENARIO: same_station,
            },
            "resourceReuse": resource_reuse,
            "commands": commands,
            "historicalScenarios": list(HISTORICAL_SCENARIOS),
            "unprovenScenarios": list(EXPLICITLY_UNPROVEN_SCENARIOS),
            "suiteRuntimeReportDigest": result.payload[
                "suiteRuntimeReportDigest"
            ],
            "provenScope": [SAME_STATION_SCENARIO],
            "unprovenScope": [
                "Browser private Social",
                "Mobile Native parity",
            ],
        }


def main() -> int:
    return SocialPrivateDesktopGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
