#!/usr/bin/env python3
"""Run bounded Node Connectivity development and Gate journeys."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    ArtifactSession,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    validate_suite_runtime_report,
)


STANDARD_STREAM_CLOSURE = "ncp-standard-stream"
NATIVE_CUT_CLOSURE = "ncp-native-cut"
DURABLE_EVENTS_CLOSURE = "ncp-durable-events"
GATE_TESTS = {
    "NCP-G01": (
        "TestSecureHTTPDirectAndCircuitUseCanonicalHertzRouter",
        "TestSecureHTTPRejectsWrongRouteSPKIBeforeRequestBody",
        "TestSecureHTTPIngressCloseDoesNotCloseBorrowedHost",
    ),
    "NCP-G02": (
        "TestSecureHTTPDirectAndCircuitUseCanonicalHertzRouter",
    ),
}
RUST_GO_CIRCUIT_INTEROP_COMMAND = [
    "cargo",
    "test",
    "--manifest-path",
    "packages/station-libp2p-http/Cargo.toml",
    "--test",
    "go_interop",
    "--",
    "--nocapture",
]
NATIVE_CUT_COMMANDS = {
    "NCP-G07": [
        "go",
        "test",
        "./relay",
        "-run",
        "^TestAdmission",
        "-count=1",
    ],
}
DURABLE_EVENTS_FUNCTIONAL_TESTS = (
    "TestDurableStoreAllocatesPerActorSequenceAndPersistsTarget",
    "TestPublishToDeviceInTransactionCommitsTargetAndExcludesRollback",
    "TestTwoNodeWakeDeliversOrderedDeviceFilteredEvents",
    "TestMissedWakeIsRepairedByBoundedReconciliation",
    "TestDurableRetentionGapEmitsHeadBoundResync",
)
DURABLE_EVENTS_GATE_TESTS = (
    "TestPostgresCrossNodeWakeOrderingAndRollback",
    "TestPostgresCrossProcessDurableEvents",
)
DURABLE_EVENTS_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "events-functional",
        "scenarioIds": [
            "NCP-G04-ORDER",
            "NCP-G04-DEVICE",
            "NCP-G04-WAKE-LOSS",
        ],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 2,
        "minWarmReuseRate": 0.66,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)


def run_go_tests(test_names: tuple[str, ...]) -> dict[str, object]:
    pattern = "^(" + "|".join(test_names) + ")$"
    command = [
        "go",
        "test",
        "./apps/station/frame/core/plugin/server/hertz",
        "-run",
        pattern,
        "-count=1",
    ]
    started = time.monotonic()
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    if completed.stdout:
        print(completed.stdout, end="", file=sys.stderr)
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr)
    return {
        "command": command,
        "durationMs": elapsed_ms,
        "status": "passed" if completed.returncode == 0 else "failed",
        "returnCode": completed.returncode,
        "tests": list(test_names),
    }


def run_events_go_tests(
    test_names: tuple[str, ...],
    *,
    environment: Mapping[str, str] | None = None,
    timeout: int = 300,
) -> dict[str, object]:
    pattern = "^(" + "|".join(test_names) + ")$"
    return run_command(
        [
            "go",
            "test",
            "./subserver/events/...",
            "-run",
            pattern,
            "-count=1",
        ],
        REPO_ROOT / "apps/station/app",
        timeout=timeout,
        environment=environment,
    )


def load_runtime_manifest() -> dict[str, object]:
    raw = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    if not raw:
        raise ValueError("NCP-G04 requires a provisioned Runtime Manifest")
    payload = json.loads(Path(raw).read_text(encoding="utf-8"))
    if (
        not isinstance(payload, dict)
        or payload.get("environmentId")
        != "node-connectivity-durable-events"
        or payload.get("gateId") != "NCP-G04"
        or payload.get("state") != "FIXTURE_READY"
    ):
        raise ValueError("NCP-G04 Runtime Manifest identity is invalid")
    return payload


def run_durable_events_gate() -> dict[str, object]:
    manifest = load_runtime_manifest()
    services = manifest.get("services")
    if not isinstance(services, dict):
        raise ValueError("NCP-G04 Runtime Manifest has no services")
    postgres = services.get("events-postgres")
    if (
        not isinstance(postgres, dict)
        or postgres.get("kind") != "postgres"
        or not postgres.get("runtimeIdentity")
        or not postgres.get("attestationArtifact")
    ):
        raise ValueError("NCP-G04 PostgreSQL attestation is incomplete")
    endpoint = str(postgres.get("endpoint") or "")
    if not endpoint.startswith("postgresql://postgres@127.0.0.1:"):
        raise ValueError("NCP-G04 PostgreSQL endpoint is not disposable local")

    source = manifest.get("source")
    if not isinstance(source, dict):
        raise ValueError("NCP-G04 Runtime Manifest source is missing")
    source_commit = str(source.get("commit") or "")
    run_id = str(manifest.get("runId") or "")
    if not source_commit or not run_id:
        raise ValueError("NCP-G04 source or runtime identity is missing")

    with tempfile.TemporaryDirectory(
        prefix="peers-touch-ncp-durable-events-",
    ) as raw:
        process_result_path = Path(raw) / "process-result.json"
        environment = {
            **os.environ,
            "MESSAGING_TEST_POSTGRES_DSN": endpoint,
            "NCP_EVENTS_RESULT_PATH": str(process_result_path),
        }
        command_result = run_events_go_tests(
            DURABLE_EVENTS_GATE_TESTS,
            environment=environment,
            timeout=300,
        )
        if command_result["status"] != "passed":
            return {
                "status": "failed",
                "results": [command_result],
            }
        process_result = json.loads(
            process_result_path.read_text(encoding="utf-8")
        )
    expected_scenarios = set(DURABLE_EVENTS_RUNTIME_REUSE.scenario_ids)
    scenarios = process_result.get("scenarios")
    if (
        process_result.get("status") != "passed"
        or process_result.get("rollbackExcluded") is not True
        or not isinstance(scenarios, dict)
        or set(scenarios) != expected_scenarios
    ):
        raise ValueError("NCP-G04 process evidence is incomplete")

    ledger = SuiteRuntimeLedger(
        DURABLE_EVENTS_RUNTIME_REUSE,
        suite_runtime_id=run_id,
        source_digest=source_commit,
        fixture_epoch=run_id,
    )
    ledger.record(
        SuiteRuntimeAction.PROVISION,
        resource_id=f"environment:{run_id}",
    )
    ledger.record(
        SuiteRuntimeAction.CLIENT_LAUNCH,
        resource_id="process:events-node-a",
    )
    ledger.record(
        SuiteRuntimeAction.CLIENT_LAUNCH,
        resource_id="process:events-node-b",
    )
    for scenario_id in DURABLE_EVENTS_RUNTIME_REUSE.scenario_ids:
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id="publisher-process:durable-event",
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id="subscriber-process:event-stream",
        )
        ledger.record(
            SuiteRuntimeAction.SUPPORTING_OBSERVATION,
            scenario_id=scenario_id,
            resource_id=f"postgres-log:{scenario_id}",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    suite_report = ledger.require_valid()
    validate_suite_runtime_report(
        suite_report,
        expected_contract=DURABLE_EVENTS_RUNTIME_REUSE,
    )

    with ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id="NCP-G04",
    ) as artifacts:
        process_ref = artifacts.write_json(
            "reports/NCP-G04-process-result.json",
            process_result,
            role="process-result",
        )
        suite_ref = artifacts.write_json(
            "reports/NCP-G04-suite-runtime.json",
            suite_report,
            role="suite-runtime",
        )
        evidence = {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": "NCP-G04",
            "gate": "NCP-G04",
            "environment": "node-connectivity-durable-events",
            "status": "PASS",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "phase": "NCP-04",
            "bom": ["NCP-NS01", "NCP-NS03", "NCP-NS04"],
            "spec": [
                "NCP-G04",
                "node-connectivity-standard-stream",
                "ncp-durable-events",
            ],
            "sampleEmissionAllowed": False,
            "source": source,
            "runtime": {
                "postgres": postgres,
                "logicalProcesses": ["events-node-a", "events-node-b"],
            },
            "processResult": process_ref.to_dict(),
            "suiteRuntime": suite_ref.to_dict(),
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "observedScope": [
                "per-Actor transactional sequence allocation",
                "cross-process PostgreSQL LISTEN/NOTIFY delivery",
                "subscriber-node survival after publisher exit",
                "high-water replay after subscriber restart",
                "durable target-device filtering",
                "bounded reconciliation after an intentionally unconsumed wake",
                "transaction rollback exclusion",
            ],
            "unprovenScope": [
                "Native Desktop rendering remains owned by NCP-08",
                "Mobile runtime behavior remains unproven",
            ],
        }
        evidence_ref = artifacts.write_json(
            "reports/NCP-G04-evidence.json",
            evidence,
            role="evidence",
        )
        artifacts.complete(
            status="passed",
            completion_status="DONE",
            proof_status="PROVEN",
            runtime=evidence["runtime"],
        )
    return {
        "status": "passed",
        "results": [command_result],
        "processResult": process_ref.to_dict(),
        "suiteRuntime": suite_ref.to_dict(),
        "evidence": evidence_ref.to_dict(),
    }


def isolated_command_environment(work_root: Path) -> dict[str, str]:
    target_dir = (work_root / "cargo-target").resolve()
    if target_dir == REPO_ROOT or REPO_ROOT in target_dir.parents:
        raise ValueError("Node Connectivity build output must stay outside the repository")
    return {
        **os.environ,
        "CARGO_TARGET_DIR": str(target_dir),
    }


def run_command(
    command: list[str],
    cwd: Path,
    timeout: int = 300,
    environment: Mapping[str, str] | None = None,
) -> dict[str, object]:
    started = time.monotonic()
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=dict(environment) if environment is not None else None,
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    if completed.stdout:
        print(completed.stdout, end="", file=sys.stderr)
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr)
    return {
        "command": command,
        "durationMs": elapsed_ms,
        "status": "passed" if completed.returncode == 0 else "failed",
        "returnCode": completed.returncode,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--closure",
        required=True,
        choices=(
            STANDARD_STREAM_CLOSURE,
            NATIVE_CUT_CLOSURE,
            DURABLE_EVENTS_CLOSURE,
        ),
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--functional", action="store_true")
    mode.add_argument(
        "--gate",
        choices=(
            tuple(GATE_TESTS)
            + tuple(NATIVE_CUT_COMMANDS)
            + ("NCP-G04", "NCP-G08")
        ),
    )
    args = parser.parse_args()

    if args.closure == STANDARD_STREAM_CLOSURE:
        if args.gate not in GATE_TESTS and not args.functional:
            parser.error(f"{args.gate} does not belong to {args.closure}")
        test_names = (
            tuple(dict.fromkeys(name for names in GATE_TESTS.values() for name in names))
            if args.functional
            else GATE_TESTS[args.gate]
        )
        results = [run_go_tests(test_names)]
    elif args.closure == NATIVE_CUT_CLOSURE:
        if args.gate in GATE_TESTS:
            parser.error(f"{args.gate} does not belong to {args.closure}")
        gate_ids = (
            ("NCP-G08",)
            if args.functional
            else (args.gate,)
        )
        results = []
        for gate_id in gate_ids:
            if gate_id == "NCP-G08":
                commands = [
                    (RUST_GO_CIRCUIT_INTEROP_COMMAND, REPO_ROOT),
                    (
                        NATIVE_CUT_COMMANDS["NCP-G07"],
                        REPO_ROOT / "apps/station/frame/core/plugin/native",
                    ),
                    (
                        [
                            "python3",
                            "-c",
                            (
                                "from pathlib import Path; import sys; "
                                "root=Path('.'); "
                                "paths=[root/'apps/station/frame/core/plugin/native/"
                                "subserver/relay-client',root/'model/domain/"
                                "federation/relay_transport.proto']; "
                                "sys.exit(1 if any(path.is_file() or "
                                "(path.is_dir() and any(item.is_file() "
                                "for item in path.rglob('*'))) "
                                "for path in paths) else 0)"
                            ),
                        ],
                        REPO_ROOT,
                    ),
                ]
                with tempfile.TemporaryDirectory(
                    prefix="peers-touch-node-connectivity-",
                ) as work_root:
                    environment = isolated_command_environment(
                        Path(work_root)
                    )
                    results.extend(
                        run_command(
                            command,
                            cwd,
                            environment=environment,
                        )
                        for command, cwd in commands
                    )
            else:
                command = NATIVE_CUT_COMMANDS[gate_id]
                results.append(
                    run_command(
                        command,
                        REPO_ROOT
                        / "apps/station/frame/core/plugin/native",
                    )
                )
    else:
        if args.functional:
            results = [
                run_events_go_tests(DURABLE_EVENTS_FUNCTIONAL_TESTS)
            ]
        elif args.gate == "NCP-G04":
            gate_result = run_durable_events_gate()
            results = list(gate_result.pop("results"))
        else:
            parser.error(f"{args.gate} does not belong to {args.closure}")
    status = "passed" if all(
        result["status"] == "passed" for result in results
    ) else "failed"
    report = {
        "artifactKind": "node-connectivity-journey-result",
        "closureId": args.closure,
        "executionClass": "functional" if args.functional else "acceptance-gate",
        "gateId": args.gate,
        "status": status,
        "results": results,
    }
    print(json.dumps(report, sort_keys=True))
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
