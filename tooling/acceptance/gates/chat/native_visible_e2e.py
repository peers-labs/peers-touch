#!/usr/bin/env python3
"""Fail-closed validator for W8 visible-native Chat reports."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from native_visible_runner import REPORT_NAMES, commits_match, source_identity


REQUIRED_STEPS = {
    "process.start",
    "ports.ready",
    "observer.ready",
    "station.selected",
    "login.submitted",
    "shell.ready",
    "device.registered",
    "bundle.published",
    "conversation.open",
    "sessions.ready",
    "message.submitted",
    "message.received",
    "message.decrypted",
    "receipt.delivered",
    "receipt.read",
}
MAX_STEP_TIMEOUT_MS = 900_000

MINIMUM_ASSERTIONS = {
    "two-client": 2,
    "multi-device": 1,
    "recovery": 2,
    "group-mls": 1,
}


class GateError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def load_report(path: Path) -> dict[str, Any]:
    require(path.exists(), f"source report is missing: {path}")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise GateError(f"source report is invalid JSON: {error}") from error
    require(isinstance(report, dict), "source report must be an object")
    return report


def validate_station(report: dict[str, Any]) -> None:
    station = report.get("station")
    require(isinstance(station, dict), "Station identity is required")
    for field in ("url", "commit", "workspaceDigest", "protoDigest", "attestation"):
        require(nonempty(station.get(field)), f"Station {field} is required")
    require(station["workspaceDigest"] == "clean", "dirty Station evidence is forbidden")
    live = station.get("live")
    require(isinstance(live, dict), "live Station metadata is required")
    require(
        commits_match(str(live.get("build_commit") or ""), station["commit"]),
        "live Station commit does not match attestation",
    )


def validate_clients(report: dict[str, Any], journey: str) -> None:
    clients = report.get("clients")
    expected_count = {"two-client": 2, "multi-device": 3, "recovery": 2, "group-mls": 3}[journey]
    require(
        isinstance(clients, list) and len(clients) == expected_count,
        f"{journey} requires exactly {expected_count} clients",
    )
    unique_fields = (
        "name",
        "deviceId",
        "profile",
        "gatewayPort",
        "rendererPort",
        "webdriverPort",
        "storageRoot",
    )
    for field in unique_fields:
        values = {
            str(client.get(field) or "")
            for client in clients
            if isinstance(client, dict)
        }
        require("" not in values and len(values) == expected_count, f"clients require distinct {field}")

    station = report["station"]
    for client in clients:
        require(isinstance(client, dict), "client entries must be objects")
        for field in ("ptid", "commit", "workspaceDigest", "protoDigest"):
            require(nonempty(client.get(field)), f"{client.get('name')}: {field} is required")
        require(str(client["ptid"]).startswith("ptid:"), "client PTID must be canonical")
        require(client["commit"] == station["commit"], "Station/client commits do not match")
        require(client["protoDigest"] == station["protoDigest"], "Station/client proto digests do not match")

    worktrees = [
        Path(item).resolve()
        for item in os.environ.get("CHAT_NATIVE_CLIENT_WORKTREES", "").split(",")
        if item.strip()
    ]
    if worktrees:
        if len(worktrees) == 1:
            worktrees *= expected_count
        require(len(worktrees) == expected_count, "validator worktree count mismatch")
        for client, worktree in zip(clients, worktrees):
            require(
                {
                    "commit": client["commit"],
                    "workspaceDigest": client["workspaceDigest"],
                    "protoDigest": client["protoDigest"],
                }
                == source_identity(worktree),
                f"{client['name']}: source identity is stale",
            )


def validate_steps(report: dict[str, Any]) -> None:
    steps = report.get("steps")
    require(isinstance(steps, list) and steps, "bounded step telemetry is required")
    seen = set()
    for step in steps:
        require(isinstance(step, dict), "step telemetry entries must be objects")
        require(step.get("status") == "pass", f"{step.get('step')}: step must pass")
        require(
            isinstance(step.get("timeoutMs"), int)
            and 0 < step["timeoutMs"] <= MAX_STEP_TIMEOUT_MS,
            f"{step.get('step')}: bounded timeout is required",
        )
        require(
            isinstance(step.get("durationMs"), int) and step["durationMs"] >= 0,
            f"{step.get('step')}: duration is required",
        )
        require(nonempty(step.get("startedAt")) and nonempty(step.get("finishedAt")), "step timestamps are required")
        seen.add(step.get("step"))
    missing = REQUIRED_STEPS - seen
    require(not missing, f"required telemetry steps are missing: {sorted(missing)}")


def validate_assertions(report: dict[str, Any], journey: str) -> None:
    assertions = report.get("assertions")
    require(
        isinstance(assertions, list) and len(assertions) >= MINIMUM_ASSERTIONS[journey],
        f"{journey} is missing journey assertions",
    )
    for assertion in assertions:
        require(isinstance(assertion, dict), "assertion entries must be objects")
        require(nonempty(assertion.get("id")), "assertion ID is required")
        require(assertion.get("status") == "pass", f"{assertion.get('id')}: assertion must pass")

    if journey == "multi-device":
        receivers = assertions[0].get("receivers")
        require(isinstance(receivers, list) and len(receivers) == 2, "multi-device send must reach both devices")
        message_ids = {receiver.get("messageUlid") for receiver in receivers}
        require(len(message_ids) == 1 and None not in message_ids, "both devices must observe one message identity")
    if journey == "recovery":
        require(
            any(item.get("id") == "reinstall.restore" for item in assertions),
            "recovery report must prove reinstall restore",
        )
    if journey == "group-mls":
        require(
            any(item.get("id") == "group.mls.add-send-remove" for item in assertions),
            "MLS report must prove add/send/remove",
        )


def validate_cleanup(report: dict[str, Any]) -> None:
    cleanup = report.get("cleanup")
    require(isinstance(cleanup, dict), "cleanup evidence is required")
    require(cleanup.get("status") == "pass", "native cleanup must pass")
    require(cleanup.get("storageReleased") is True, "native storage must be released")
    require(not cleanup.get("failures"), "native cleanup cannot contain failures")
    clients = cleanup.get("clients")
    require(isinstance(clients, list) and clients, "per-client cleanup is required")
    for client in clients:
        require(isinstance(client, dict), "cleanup client entry must be an object")
        ports = client.get("ports")
        require(isinstance(ports, dict) and ports, "cleanup port evidence is required")
        for name, port in ports.items():
            require(
                isinstance(port, dict) and port.get("released") is True,
                f"{client.get('client')}: {name} port must be released",
            )


def validate_report(report: dict[str, Any], journey: str) -> None:
    require(report.get("artifactKind") == f"chat-native-{journey}-run", "unexpected artifactKind")
    require(report.get("producer") == "chat-native-visible-runner", "unexpected producer")
    require(report.get("phase") == "W8", "source phase traceability is required")
    require(report.get("bom") == [f"CHAT-NATIVE-{journey.upper()}"], "source BOM traceability is required")
    require(report.get("spec") == ["chat-native-visible-clients"], "source spec traceability is required")
    require(report.get("gate") == f"chat-native-{journey}-e2e", "source Gate traceability is required")
    require(report.get("automated") is True, "automated evidence is required")
    require(report.get("runtime") == "visible-native-desktop", "visible native runtime is required")
    require(report.get("status") == "pass", "source report must pass")
    require(report.get("completionStatus") == "DONE", "source report must be complete")
    require(report.get("proofStatus") == "PROVEN", "source report must be proven")
    require(report.get("sampleEmissionAllowed") is False, "sample evidence is forbidden")
    for field in ("dryRun", "apiOnly", "browserOnly"):
        require(report.get(field) is False, f"{field} evidence is forbidden")
    require(nonempty(report.get("capturedAt")), "capturedAt is required")
    require(not report.get("failure"), "passing report cannot contain a failure")
    require(not report.get("failureDiagnostics"), "passing report cannot contain failure diagnostics")
    launch_order = report.get("launchOrder")
    require(isinstance(launch_order, list), "launch order is required")
    require(len(launch_order) == len(set(launch_order)), "launch order contains duplicates")
    runtime_manifest = report.get("runtimeManifest")
    require(isinstance(runtime_manifest, dict), "runtime manifest evidence is required")
    require(nonempty(runtime_manifest.get("path")), "runtime manifest path is required")
    require(nonempty(runtime_manifest.get("runId")), "runtime manifest runId is required")
    require(
        runtime_manifest.get("state") == "FIXTURE_READY",
        "runtime manifest must be FIXTURE_READY",
    )
    validate_station(report)
    validate_clients(report, journey)
    validate_steps(report)
    validate_assertions(report, journey)
    validate_cleanup(report)


def write_validation(path: Path, source: Path, report: dict[str, Any], journey: str) -> None:
    payload = {
        "artifactKind": f"chat-native-{journey}-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "W8",
        "bom": [f"CHAT-NATIVE-{journey.upper()}"],
        "spec": ["chat-native-visible-clients"],
        "gate": f"chat-native-{journey}-e2e",
        "sourceArtifact": str(source),
        "stationCommit": report["station"]["commit"],
        "protoDigest": report["station"]["protoDigest"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--journey", choices=sorted(REPORT_NAMES), required=True)
    parser.add_argument("--source")
    parser.add_argument("--output")
    args = parser.parse_args()
    source = Path(args.source or f"tooling/acceptance/reports/{REPORT_NAMES[args.journey]}")
    output = Path(
        args.output
        or f"tooling/acceptance/reports/chat-native-{args.journey}-validation.json"
    )
    report = load_report(source)
    validate_report(report, args.journey)
    write_validation(output, source, report, args.journey)
    print(f"[OK] {args.journey}: {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"visible native acceptance failed: {error}", file=sys.stderr)
        raise SystemExit(1)
