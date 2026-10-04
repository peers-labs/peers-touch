"""Formal Native Desktop proof consumer for the CSS-09 Suite."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import (
    SCENARIO_IDS,
    attach_suite_evidence,
    load_suite_result,
    optional_acceptance_runtime_manifest,
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-native-e2e"
    phase = "CSS-09 Cross-Station Social Native E2E"
    bom = ("CSS-09",)
    spec = (
        "docs/architecture/cross-station-social/execution-plans/"
        "20261003-native-private-social/plan.md",
        "docs/architecture/social/acceptance-matrix.md",
    )

    def run(self) -> dict[str, Any]:
        result = load_suite_result()
        attach_suite_evidence(self, result)

        provisioned = optional_acceptance_runtime_manifest()
        if provisioned is not None:
            manifest_path, manifest = provisioned
            self.report.manifest = manifest
            self.report.add_evidence_file(
                "acceptance-runtime-manifest",
                manifest_path,
            )

        for scenario_id in SCENARIO_IDS:
            scenario = result.payload["scenarioResults"][scenario_id]
            self.assert_condition(
                scenario_id,
                scenario["status"] == "PASS"
                and bool(scenario["evidenceRefs"]),
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
            "scenarioResults": result.payload["scenarioResults"],
            "resourceReuse": result.payload["resourceReuse"],
            "suiteRuntimeReportDigest": result.payload[
                "suiteRuntimeReportDigest"
            ],
            "provenScope": list(SCENARIO_IDS),
            "unprovenScope": [
                "Mobile Native parity",
                "cross-Federation private delivery",
            ],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
