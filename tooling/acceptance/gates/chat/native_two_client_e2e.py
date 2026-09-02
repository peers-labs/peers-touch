#!/usr/bin/env python3
"""Fail-closed validator for the Core native two-client Chat report."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
    commits_match,
    current_commit,
    current_workspace_digest,
)


SOURCE_REPORT = Path(
    os.environ.get(
        "CHAT_NATIVE_TWO_CLIENT_REPORT",
        "tooling/acceptance/reports/chat-native-two-client-run.json",
    )
)
VALIDATED_REPORT = Path(
    "tooling/acceptance/reports/chat-native-two-client-validation.json"
)
REQUIRED_STEPS = {
    "station.identity",
    "fixture.reset",
    "client.authenticated",
    "conversation.open",
    "message.submitted",
    "message.received",
    "message.decrypted",
    "receipt.delivered",
}


class GateError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def load_report(path: Path) -> dict[str, Any]:
    require(path.exists(), f"native two-client report is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise GateError(f"native two-client report is invalid JSON: {error}") from error
    require(isinstance(value, dict), "native two-client report must be an object")
    return value


def validate_report(report: dict[str, Any]) -> None:
    require(
        report.get("gate") == "chat-native-two-client-e2e",
        "unexpected native two-client gate ID",
    )
    require(report.get("status") == "PASS", "native two-client report must pass")
    require(
        str(report.get("station_url") or "").startswith("http"),
        "explicit Station URL is required",
    )

    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    require(
        runtime.get("runtimeCell") == "native-tauri-embedded-webdriver",
        "runtime cell must be native Tauri embedded WebDriver",
    )
    require(
        runtime.get("journey") == "direct-delivered-receipt",
        "unexpected native two-client journey",
    )
    require(
        runtime.get("testedCommit") == current_commit(),
        "native two-client report commit is stale",
    )
    require(
        runtime.get("testedWorkspaceDigest") == current_workspace_digest(),
        "native two-client workspace digest is stale",
    )
    station_live = runtime.get("stationLive")
    require(isinstance(station_live, dict), "live Station identity is required")
    require(
        commits_match(
            str(station_live.get("build_commit") or ""),
            str(runtime.get("testedCommit") or ""),
        ),
        "Station/client commit mismatch",
    )

    actors = report.get("actors")
    require(
        isinstance(actors, dict) and set(actors) == {"alice", "bob"},
        "exactly Alice and Bob actor evidence is required",
    )
    for field in ("port", "gateway_port", "profile", "storage_root", "pid"):
        values = {str(actor.get(field) or "") for actor in actors.values()}
        require("" not in values and len(values) == 2, f"actors require distinct {field}")
    require(
        all(
            actor.get("runtime") == "native-tauri-embedded-webdriver"
            for actor in actors.values()
        ),
        "both actors must use native Tauri embedded WebDriver",
    )

    assertions = report.get("assertions")
    require(isinstance(assertions, list), "assertions must be a list")
    by_name = {
        str(assertion.get("name") or ""): assertion
        for assertion in assertions
        if isinstance(assertion, dict)
    }
    missing = REQUIRED_ASSERTIONS - set(by_name)
    require(not missing, f"required assertions are missing: {sorted(missing)}")
    for name in sorted(REQUIRED_ASSERTIONS):
        require(by_name[name].get("passed") is True, f"{name} must pass")

    steps = runtime.get("steps")
    require(isinstance(steps, list), "bounded step evidence is required")
    passed_steps = {
        str(step.get("step") or "")
        for step in steps
        if isinstance(step, dict) and step.get("status") == "pass"
    }
    missing_steps = REQUIRED_STEPS - passed_steps
    require(not missing_steps, f"required steps are missing: {sorted(missing_steps)}")

    evidence = report.get("evidence")
    require(isinstance(evidence, dict), "evidence map is required")
    for actor in ("alice", "bob"):
        for suffix in ("screenshot", "dom", "app-log"):
            key = f"{actor}-{suffix}"
            entry = evidence.get(key)
            if isinstance(entry, dict) and entry.get("artifactKind") == "acceptance-artifact-ref":
                from tooling.acceptance.core import resolve_artifact_root, REPO_ROOT
                root = resolve_artifact_root(repo_root=REPO_ROOT)
                workspace_id = entry.get("workspaceId", "")
                run_id = entry.get("runId", "")
                gate_id = entry.get("gateId", "")
                rel_path = entry.get("path", "")
                path = root / workspace_id / gate_id / run_id / rel_path
            else:
                path = Path(str(entry or ""))
            require(str(path) not in {"", "."} and path.exists(), f"{key} evidence is missing")


def write_validation(report: dict[str, Any]) -> None:
    output = {
        "artifactKind": "chat-native-two-client-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "chat-native-two-client",
        "bom": ["CHAT-DIRECT-DELIVERED-01"],
        "spec": ["chat-direct-delivered-receipt"],
        "gate": "chat-native-two-client-e2e",
        "sourceArtifact": str(SOURCE_REPORT),
        "testedCommit": report["runtime"]["testedCommit"],
        "assertionCount": len(REQUIRED_ASSERTIONS),
    }
    VALIDATED_REPORT.parent.mkdir(parents=True, exist_ok=True)
    VALIDATED_REPORT.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    report = load_report(SOURCE_REPORT)
    validate_report(report)
    write_validation(report)
    print("Chat Native Two-Client E2E")
    print("==========================")
    print(f"[OK] source: {SOURCE_REPORT}")
    print(f"[OK] report: {VALIDATED_REPORT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"chat native two-client validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
