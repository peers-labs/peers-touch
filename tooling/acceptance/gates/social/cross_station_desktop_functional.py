"""Development-functional consumer for the immutable CSS-09 Suite result."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import (
    SCENARIO_IDS,
    attach_suite_evidence,
    load_suite_result,
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-desktop-functional"
    phase = "CSS-09 Social Desktop Functional Evidence"
    bom = ("CSS-09",)
    spec = (
        "docs/architecture/cross-station-social/execution-plans/"
        "20261003-native-private-social/plan.md",
    )

    def run(self) -> dict[str, Any]:
        result = load_suite_result()
        attach_suite_evidence(self, result)
        for scenario_id in SCENARIO_IDS:
            self.assert_condition(
                scenario_id,
                result.payload["scenarioResults"][scenario_id]["status"]
                == "PASS",
            )
        self.assert_condition(
            "suite-cleanup",
            result.payload["cleanup"]["status"] == "CLEANED",
        )
        return {
            "evidenceClass": "DEVELOPMENT_FUNCTIONAL",
            "proofState": "UNPROVEN",
            "controlCommit": result.payload["controlCommit"],
            "sourceCommit": result.payload["sourceCommit"],
            "scenarioResults": result.payload["scenarioResults"],
            "resourceReuse": result.payload["resourceReuse"],
            "suiteRuntimeReportDigest": result.payload[
                "suiteRuntimeReportDigest"
            ],
            "provenScope": [],
            "unprovenScope": [
                "formal Acceptance proof remains owned by "
                "social-cross-station-native-e2e"
            ],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
