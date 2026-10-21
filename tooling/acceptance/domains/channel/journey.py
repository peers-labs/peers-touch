#!/usr/bin/env python3
"""Run one exact-source, receiver-visible Lark Channel Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from tooling.acceptance.core import (  # noqa: E402
    GateError,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.core.redaction import redact_value  # noqa: E402
from tooling.acceptance.domains.channel.contract import (  # noqa: E402
    SuiteManifest,
    journey_contract,
)
from tooling.acceptance.domains.channel.runtime import (  # noqa: E402
    LiveJourneyRuntime,
    canonical_digest,
)


RESULT_KIND = "lark-channel-journey-result"
RESULT_VERSION = 1


def _result_payload(
    *,
    manifest: SuiteManifest,
    journey_id: str,
    gate_id: str,
    scenario_results: dict[str, dict[str, Any]],
    suite_runtime: dict[str, Any],
    cleanup: dict[str, Any],
    duration_seconds: float,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "artifactKind": RESULT_KIND,
        "schemaVersion": RESULT_VERSION,
        "journeyId": journey_id,
        "gateId": gate_id,
        "status": "PASS",
        "completionStatus": "FUNCTIONAL_PASS",
        "proofStatus": "CURRENT_SOURCE_RECEIVER_VISIBLE",
        "source": {
            "commit": manifest.source.commit,
            "workspaceDigest": manifest.source.workspace_digest,
            "protocolDigest": manifest.source.protocol_digest,
            "stationRuntimeIdentity": manifest.station.runtime_identity,
        },
        "suiteRuntimeId": manifest.suite_runtime_id,
        "fixtureEpoch": manifest.fixture_epoch,
        "scenarioResults": scenario_results,
        "suiteRuntime": suite_runtime,
        "cleanup": cleanup,
        "durationSeconds": round(duration_seconds, 3),
    }
    result["resultDigest"] = canonical_digest(result)
    return redact_value(result)


def run_live_journey(
    manifest_path: str | Path,
    journey_id: str,
) -> dict[str, Any]:
    contract = journey_contract(journey_id)
    manifest = SuiteManifest.load(manifest_path)
    manifest.require_for(contract)
    reuse_contract = RuntimeReuseContract.from_dict(contract.runtime_reuse)
    ledger = SuiteRuntimeLedger(
        reuse_contract,
        suite_runtime_id=manifest.suite_runtime_id,
        source_digest=manifest.source.commit,
        fixture_epoch=manifest.fixture_epoch,
    )
    ledger.record(
        SuiteRuntimeAction.PROVISION,
        resource_id=f"suite:{manifest.suite_runtime_id}",
    )
    if "desktop-native" in contract.required_capabilities:
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="client:desktop-native",
        )

    runtime: LiveJourneyRuntime | None = None
    scenario_results: dict[str, dict[str, Any]] = {}
    cleanup: dict[str, Any] = {}
    primary_error: Exception | None = None
    started = time.monotonic()
    try:
        runtime = LiveJourneyRuntime(manifest, contract)
        runtime.preflight()
        for scenario_id in contract.scenario_ids:
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            scenario_started = time.monotonic()
            evidence = runtime.run_scenario(scenario_id)
            duration = time.monotonic() - scenario_started
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id=scenario_id,
                resource_id=evidence.product_action["resourceIdHash"],
                duration_seconds=duration,
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id=scenario_id,
                resource_id=(
                    f"{evidence.receiver['kind']}:"
                    f"{evidence.receiver['messageIdHash']}"
                ),
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id=scenario_id,
                resource_id=(
                    f"station:{evidence.station['turnIdHash']}:"
                    f"{evidence.station['deliveryIdHash']}"
                ),
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id=scenario_id,
            )
            scenario_results[scenario_id] = {
                "status": "PASS",
                "expected": (
                    contract.outcome
                    if scenario_id.endswith("-OUTCOME")
                    else contract.risk
                ),
                "evidence": evidence.to_dict(),
            }
        cleanup = runtime.cleanup()
        ledger.record(
            SuiteRuntimeAction.CLEANUP_COMPLETE,
            resource_id=f"cleanup:{manifest.suite_runtime_id}",
        )
    except Exception as error:
        primary_error = error
        if runtime is not None:
            try:
                cleanup = runtime.cleanup()
            except Exception as cleanup_error:
                raise GateError(
                    f"{error}; cleanup also failed: {cleanup_error}"
                ) from error
        raise
    finally:
        if runtime is not None:
            try:
                runtime.close()
            except Exception:
                if primary_error is None:
                    raise

    suite_runtime = ledger.require_valid()
    return _result_payload(
        manifest=manifest,
        journey_id=contract.journey_id,
        gate_id=contract.gate_id,
        scenario_results=scenario_results,
        suite_runtime=suite_runtime,
        cleanup=cleanup,
        duration_seconds=time.monotonic() - started,
    )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one live Lark Channel receiver Journey",
    )
    parser.add_argument("--journey", required=True)
    parser.add_argument(
        "--manifest",
        default=os.environ.get("PT_SUITE_RUNTIME_MANIFEST", ""),
    )
    parser.add_argument("--output")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if not args.manifest:
        print(
            "Lark Journey requires --manifest or PT_SUITE_RUNTIME_MANIFEST",
            file=sys.stderr,
        )
        return 2
    try:
        result = run_live_journey(args.manifest, args.journey)
    except Exception as error:
        print(
            f"FAIL: {args.journey}: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1
    encoded = json.dumps(
        result,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(f"{output.suffix}.tmp")
        temporary.write_text(encoded, encoding="utf-8")
        os.replace(temporary, output)
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
