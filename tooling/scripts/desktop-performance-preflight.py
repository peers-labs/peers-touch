#!/usr/bin/env python3
"""Generate fail-closed P0c-1/P0c-2 Desktop performance preflight evidence."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, explicit_output_path, inspect_command

DEFAULT_GATEWAY = "http://127.0.0.1:3030"
DEFAULT_STATION = "http://10.37.246.80:18080"
ARTIFACT_KIND = "desktop-performance-preflight"
PHASE = "P0c-1/P0c-2"
BOM = ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"]
SPEC = ["SPEC-RUN-01", "SPEC-GATE-01"]
GATE = "Make entrypoints, Desktop Gateway, Station health, and Gateway Station binding must pass before runtime samples are emitted"
ENTRYPOINTS = ["make station", "make desktop-web", "make desktop"]
DEFAULT_OUTPUT = "reports/desktop-performance-preflight.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run_make_dry_run(command: str) -> dict[str, Any]:
    tokens = shlex.split(command)
    if not tokens or tokens[0] != "make":
        return {
            "command": command,
            "status": "fail",
            "reason": "entrypoint is not a Make command",
        }
    started = time.time()
    completed = subprocess.run(
        ["make", "-n", *tokens[1:]],
        capture_output=True,
        text=True,
        timeout=15,
    )
    result: dict[str, Any] = {
        "command": command,
        "status": "pass" if completed.returncode == 0 else "fail",
        "durationMs": round((time.time() - started) * 1000, 3),
    }
    output = (completed.stdout + completed.stderr).strip()
    if output:
        result["dryRunOutput"] = output.splitlines()[:5]
    if completed.returncode != 0:
        result["reason"] = f"make dry-run exited {completed.returncode}"
    return result


def http_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def check_gateway(gateway: str, station: str, timeout: float) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": "desktop-gateway",
        "url": gateway,
        "expectedStation": station,
    }
    try:
        envelope = http_json(gateway, {"cmd": "station_list", "args": {}}, timeout)
        if not envelope.get("ok"):
            result.update({"status": "fail", "reason": f"station_list returned ok=false: {envelope}"})
            return result
        data = envelope.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("status"), str):
            result.update({"status": "fail", "reason": f"station_list missing JSON status: {envelope}"})
            return result
        status = json.loads(data["status"])
        active = str(status.get("active_url") or "").rstrip("/")
        result["activeStation"] = active
        if active != station.rstrip("/"):
            result.update({"status": "fail", "reason": f"active station mismatch got={active or 'empty'} want={station.rstrip('/')}"})
            return result
        result["status"] = "pass"
        return result
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError) as exc:
        result.update({"status": "fail", "reason": str(exc)})
        return result


def check_station(station: str, timeout: float) -> dict[str, Any]:
    url = station.rstrip("/") + "/sub-oss/healthz"
    result: dict[str, Any] = {"name": "station-health", "url": url}
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            result["statusCode"] = response.status
            result["status"] = "pass" if 200 <= response.status < 300 else "fail"
            if result["status"] != "pass":
                result["reason"] = f"health endpoint returned status={response.status}"
            return result
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        result.update({"status": "fail", "reason": str(exc)})
        return result


def issue_breakdown(checks: list[dict[str, Any]], source_artifact: str = DEFAULT_OUTPUT) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for check in checks:
        if check.get("status") == "pass":
            continue
        name = str(check.get("command") or check.get("name") or "unknown")
        category = "runtime-preflight"
        if name.startswith("make ") or check.get("command"):
            category = "entrypoint-contract"
        elif name == "desktop-gateway":
            category = "desktop-gateway-preflight"
        elif name == "station-health":
            category = "station-health-preflight"
        issues.append(
            {
                "category": category,
                "failedStep": name,
                "status": "diagnostic incomplete",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "summary": str(check.get("reason") or f"{name} did not pass preflight"),
                "proofImpact": "P0c-1/P0c-2 remains PARTIAL/UNPROVEN and runtime sample emission stays disabled.",
                "sourceArtifact": source_artifact,
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": PHASE,
                "sourceBom": BOM,
                "sourceSpec": SPEC,
                "sourceGate": GATE,
            }
        )
    return issues


def detail_breakdown(checks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for check in checks:
        if check.get("status") == "pass":
            continue
        step = str(check.get("command") or check.get("name") or "unknown")
        detail: dict[str, Any] = {
            "step": step,
            "status": str(check.get("status") or "fail"),
            "reason": str(check.get("reason") or f"{step} did not pass preflight"),
        }
        for key in ("url", "expectedStation", "activeStation", "statusCode"):
            if key in check:
                detail[key] = check[key]
        details.append(detail)
    return details


def recommended_review_commands(gateway: str, station: str) -> list[dict[str, str]]:
    return [
        {"purpose": "Start or repair the planned Station runtime entrypoint.", "command": "make station"},
        {"purpose": "Start the planned Desktop Tauri runtime entrypoint.", "command": "make desktop"},
        {"purpose": "Inspect the preflight source artifact.", "command": inspect_command("desktop-performance-preflight-gate", DEFAULT_OUTPUT)},
        {"purpose": "Run the live Gateway -> Station telemetry gate after preflight passes.", "command": f"python3 tooling/scripts/desktop-telemetry-live-gate.py --gateway {gateway} --station {station}"},
        {"purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.", "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"},
    ]


def build_report(gateway: str, station: str, timeout: float, source_artifact: str = DEFAULT_OUTPUT) -> dict[str, Any]:
    entrypoints = [run_make_dry_run(command) for command in ENTRYPOINTS]
    checks: list[dict[str, Any]] = [
        *({"name": "entrypoint", **entrypoint} for entrypoint in entrypoints),
        check_station(station, timeout),
        check_gateway(gateway, station, timeout),
    ]
    issues = issue_breakdown(checks, source_artifact)
    details = detail_breakdown(checks)
    proven = not issues
    review_commands = recommended_review_commands(gateway, station)
    report = {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": "pass" if proven else "baseline preflight failure",
        "completionStatus": "DONE" if proven else "PARTIAL",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "sampleEmissionAllowed": proven,
        "gateway": gateway,
        "station": station,
        "checks": checks,
        "details": details,
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "summary": {
            "status": "pass" if proven else "baseline preflight failure",
            "completionStatus": "DONE" if proven else "PARTIAL",
            "proofStatus": "PROVEN" if proven else "UNPROVEN",
            "sampleEmissionAllowed": proven,
            "failedCheckCount": len(issues),
            "gateway": gateway,
            "station": station,
        },
        "recommended_review_commands": review_commands,
        "recommendedReviewCommands": review_commands,
    }
    if issues:
        report["failedStep"] = issues[0]["failedStep"]
        report["reason"] = issues[0]["summary"]
    return report


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default=DEFAULT_GATEWAY)
    parser.add_argument("--station", default=DEFAULT_STATION)
    parser.add_argument("--timeout", type=float, default=2.0)
    parser.add_argument("--output")
    args = parser.parse_args()

    report = build_report(args.gateway, args.station, args.timeout, DEFAULT_OUTPUT)
    if args.output:
        output = explicit_output_path(args.output)
        write_report(output, report)
        display_output = str(output)
    else:
        with artifact_session("desktop-performance-preflight-gate") as session:
            session.write_json(DEFAULT_OUTPUT, report, role="report")
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_output = DEFAULT_OUTPUT
    print(f"desktop performance preflight: {display_output}")
    print(f"status: {report['status']}")
    return 0 if report["proofStatus"] == "PROVEN" else 1


if __name__ == "__main__":
    raise SystemExit(main())
