"""Suite Runtime evidence for the three-client foreground product Journey."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import RuntimeReuseContract, SuiteRuntimeLedger


INPUT_KIND = "peers-touch-three-client-suite-runtime-input"


def _required_text(owner: Mapping[str, Any], key: str) -> str:
    value = owner.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def build_report(value: object) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != {
        "schemaVersion",
        "kind",
        "suiteRuntimeId",
        "sourceDigest",
        "fixtureEpoch",
        "runtimeReuse",
        "events",
    }:
        raise ValueError("three-client Suite Runtime input is invalid")
    if value["schemaVersion"] != 1 or value["kind"] != INPUT_KIND:
        raise ValueError("three-client Suite Runtime input identity is invalid")
    events = value["events"]
    if not isinstance(events, list) or not events:
        raise ValueError("three-client Suite Runtime events are required")

    ledger = SuiteRuntimeLedger(
        RuntimeReuseContract.from_dict(value["runtimeReuse"]),
        suite_runtime_id=_required_text(value, "suiteRuntimeId"),
        source_digest=_required_text(value, "sourceDigest"),
        fixture_epoch=_required_text(value, "fixtureEpoch"),
    )
    for event in events:
        if not isinstance(event, Mapping) or set(event) != {
            "action",
            "scenarioId",
            "resourceId",
            "durationSeconds",
        }:
            raise ValueError("three-client Suite Runtime event is invalid")
        ledger.record(
            event["action"],
            scenario_id=event["scenarioId"],
            resource_id=event["resourceId"],
            duration_seconds=event["durationSeconds"],
        )
    return ledger.require_valid()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    report = build_report(json.loads(input_path.read_text(encoding="utf-8")))
    output_path.write_text(
        json.dumps(report, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
