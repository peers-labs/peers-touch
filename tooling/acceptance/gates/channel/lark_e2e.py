#!/usr/bin/env python3
"""Formal Gate wrapper for one live Lark Channel Journey."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any


if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from tooling.acceptance.core import AcceptanceGate, GateError  # noqa: E402
from tooling.acceptance.domains.channel.contract import (  # noqa: E402
    SuiteManifest,
    journey_contract,
)
from tooling.acceptance.domains.channel.journey import (  # noqa: E402
    run_live_journey,
)


class LarkChannelJourneyGate(AcceptanceGate):
    phase = "Lark Channel live receiver proof"
    bom = ("LARK-CLOSURE",)
    spec = (
        "docs/architecture/domains/agent/lark/acceptance-matrix.md",
        "docs/architecture/domains/agent/execution-plans/"
        "20261015-lark-capability-closure/plan.md",
    )

    def __init__(
        self,
        journey_id: str,
        manifest_path: str | Path | None,
    ) -> None:
        self.contract = journey_contract(journey_id)
        self.gate_id = self.contract.gate_id
        self.manifest_path = (
            Path(manifest_path).expanduser().resolve()
            if manifest_path
            else None
        )
        super().__init__()

    def run(self) -> dict[str, Any]:
        if self.manifest_path is None:
            raise GateError(
                "PT_SUITE_RUNTIME_MANIFEST is required for live Lark proof"
            )
        manifest = SuiteManifest.load(self.manifest_path)
        self.report.manifest = manifest.evidence_projection()
        manifest.require_for(self.contract)
        result = run_live_journey(
            self.manifest_path,
            self.contract.journey_id,
        )
        scenarios = result.get("scenarioResults")
        if not isinstance(scenarios, dict):
            raise GateError("Lark Journey result omitted Scenario evidence")
        for scenario_id in self.contract.scenario_ids:
            scenario = scenarios.get(scenario_id)
            passed = (
                isinstance(scenario, dict)
                and scenario.get("status") == "PASS"
                and isinstance(scenario.get("evidence"), dict)
            )
            self.assert_condition(
                scenario_id,
                passed,
                (
                    self.contract.outcome
                    if scenario_id.endswith("-OUTCOME")
                    else self.contract.risk
                ),
            )
        self.assert_condition(
            "suite-runtime-lifecycle",
            result.get("suiteRuntime", {}).get("result") == "PASS",
        )
        self.assert_condition(
            "task-owned-resource-cleanup",
            result.get("cleanup", {}).get("status") == "CLEANED",
        )
        return {
            "journeyId": self.contract.journey_id,
            "resultDigest": result.get("resultDigest"),
            "source": result.get("source"),
            "suiteRuntimeId": result.get("suiteRuntimeId"),
            "fixtureEpoch": result.get("fixtureEpoch"),
            "scenarioResults": scenarios,
            "suiteRuntime": result.get("suiteRuntime"),
            "cleanup": result.get("cleanup"),
            "evidenceClass": "CURRENT_SOURCE_LARK_RECEIVER_PROOF",
            "provenScope": [
                self.contract.outcome,
                self.contract.risk,
            ],
            "unprovenScope": [],
        }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--journey", required=True)
    parser.add_argument(
        "--manifest",
        default=os.environ.get("PT_SUITE_RUNTIME_MANIFEST", ""),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    return LarkChannelJourneyGate(
        args.journey,
        args.manifest or None,
    ).execute()


if __name__ == "__main__":
    raise SystemExit(main())
