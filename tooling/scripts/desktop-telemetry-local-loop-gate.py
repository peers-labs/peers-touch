#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ARTIFACT_KIND = "desktop-telemetry-local-loop-gate"
PHASE = "P0a-1/P0a-2/P0a-3/P0a-4/P0a-5/P0a-6"
BOM = ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05"]
SPEC = ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"]
GATE = (
    "Local telemetry static tests must prove Desktop envelope/queue, Gateway upload validation, "
    "Station ingest/query/rollup implementation, and Station query contract coverage while leaving live upload/query/mirror proof to env gates"
)
DEFAULT_OUTPUT = Path("tooling/acceptance/reports/desktop-telemetry-local-loop-gate.json")
TAURI_MAIN_PATH = Path("apps/desktop/src-tauri/src/main.rs")
TAURI_HTTP_GATEWAY_PATH = Path("apps/desktop/src-tauri/src/interface/http_gateway/mod.rs")
TAURI_FRONTEND_TELEMETRY_COMMAND_PATH = Path("apps/desktop/src-tauri/src/interface/tauri_commands/frontend_telemetry.rs")
DESKTOP_API_PATH = Path("apps/desktop/src/services/desktop_api.ts")

GATEWAY_UPLOAD_SOURCE_REQUIREMENTS = (
    {
        "id": "tauri-invoke-handler",
        "path": TAURI_MAIN_PATH,
        "tokens": ["frontend_telemetry::frontend_telemetry_upload"],
    },
    {
        "id": "http-gateway-command-mapping",
        "path": TAURI_HTTP_GATEWAY_PATH,
        "tokens": ['"frontend_telemetry_upload"', "frontend_telemetry_upload_with_token"],
    },
    {
        "id": "station-ingest-path",
        "path": TAURI_FRONTEND_TELEMETRY_COMMAND_PATH,
        "tokens": ['post_json_with_auth("/telemetry/frontend/events/batch"', "MAX_BATCH_EVENTS"],
    },
    {
        "id": "desktop-api-wrapper",
        "path": DESKTOP_API_PATH,
        "tokens": ["uploadFrontendTelemetry", "'frontend_telemetry_upload'"],
    },
)


@dataclass(frozen=True)
class CheckSpec:
    check_id: str
    capability: str
    command: list[str]
    cwd: str
    phase: str
    bom: list[str]
    spec: list[str]
    gate: str


CHECKS = (
    CheckSpec(
        check_id="station-ingest-query-rollup",
        capability="Station frontend telemetry ingest/query/rollup local implementation",
        command=["go", "test", "./app/subserver/frontend_telemetry"],
        cwd="apps/station",
        phase="P0a-4/P0a-5/P0a-6",
        bom=["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05"],
        spec=["SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"],
        gate="Station frontend telemetry local tests must prove ingest validation, raw persistence, raw query contract filters, and rollup query contract filters without replacing live Station mirror proof",
    ),
    CheckSpec(
        check_id="desktop-envelope-bounded-queue",
        capability="Desktop frontend telemetry envelope and bounded queue",
        command=["pnpm", "--dir", "apps/desktop", "exec", "vitest", "run", "src/kernel/frontendTelemetry.test.ts"],
        cwd=".",
        phase="P0a-1/P0a-2",
        bom=["BOM-RUN-03", "BOM-RUN-04"],
        spec=["SPEC-GW-01"],
        gate="Desktop frontend telemetry envelope and bounded queue tests must prove local inspector shape and queue behavior",
    ),
    CheckSpec(
        check_id="tauri-gateway-upload-validation",
        capability="Tauri/Gateway frontend_telemetry_upload command validation",
        command=["cargo", "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "frontend_telemetry"],
        cwd=".",
        phase="P0a-3",
        bom=["BOM-RUN-03"],
        spec=["SPEC-GW-01"],
        gate="Tauri/Gateway frontend telemetry upload command validation must prove local accept/reject/failure contract",
    ),
)


def command_text(command: list[str]) -> str:
    return " ".join(command)


def run_check(root: Path, spec: CheckSpec, timeout: int) -> dict[str, Any]:
    completed = subprocess.run(
        spec.command,
        cwd=root / spec.cwd,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    return check_result_from_exit(spec, completed.returncode, output)


def check_result_from_exit(spec: CheckSpec, returncode: int, output: str) -> dict[str, Any]:
    status = "pass" if returncode == 0 else "fail"
    return {
        "id": spec.check_id,
        "capability": spec.capability,
        "status": status,
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "command": command_text(spec.command),
        "cwd": spec.cwd,
        "returnCode": returncode,
        "phase": spec.phase,
        "bom": spec.bom,
        "spec": spec.spec,
        "gate": spec.gate,
        "outputTail": output[-3000:],
    }


def gateway_upload_source_evidence(root: Path) -> dict[str, Any]:
    requirement_results: list[dict[str, Any]] = []
    for requirement in GATEWAY_UPLOAD_SOURCE_REQUIREMENTS:
        path = requirement["path"]
        full_path = root / path
        try:
            text = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
            read_error = None
        except OSError as exc:
            text = ""
            read_error = str(exc)
        missing_tokens = [token for token in requirement["tokens"] if token not in text]
        present = full_path.exists() and not read_error and not missing_tokens
        requirement_results.append(
            {
                "id": requirement["id"],
                "path": str(path),
                "status": "pass" if present else "diagnostic incomplete",
                "proofStatus": "PROVEN" if present else "UNPROVEN",
                "missingTokens": missing_tokens,
                "readError": read_error,
            }
        )
    failed = [item for item in requirement_results if item["proofStatus"] != "PROVEN"]
    status = "pass" if not failed else "diagnostic incomplete"
    return {
        "sourceKind": "desktop-gateway-frontend-telemetry-upload-source",
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "phase": "P0a-3",
        "bom": ["BOM-RUN-03"],
        "spec": ["SPEC-GW-01"],
        "gate": "Desktop Gateway upload command source must prove Tauri invoke registration, HTTP gateway mapping, Station ingest path, and Desktop API wrapper",
        "requirements": requirement_results,
        "failedRequirementCount": len(failed),
        "failedRequirements": [item["id"] for item in failed],
    }


def issue_breakdown(
    output: Path,
    checks: list[dict[str, Any]],
    gateway_upload_source: dict[str, Any],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for check in checks:
        if check.get("status") == "pass":
            continue
        issues.append(
            {
                "category": "desktop-telemetry-local-loop-static-check",
                "failedStep": check.get("id"),
                "summary": f"{check.get('capability')} did not pass local static evidence.",
                "proofImpact": "P0a local telemetry implementation evidence remains PARTIAL/UNPROVEN until this check passes.",
                "sourceArtifact": str(output),
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": check.get("phase") or PHASE,
                "sourceBom": check.get("bom") or BOM,
                "sourceSpec": check.get("spec") or SPEC,
                "sourceGate": check.get("gate") or GATE,
                "evidenceDetails": [check],
                "recommended_review_commands": recommended_review_commands(),
                "recommendedReviewCommands": recommended_review_commands(),
            }
        )
    if gateway_upload_source.get("proofStatus") != "PROVEN":
        issues.append(
            {
                "category": "desktop-gateway-upload-source",
                "failedStep": "gateway.frontend_telemetry_upload.source",
                "summary": "Desktop Gateway frontend telemetry upload source registration is incomplete.",
                "proofImpact": "P0a-3 Gateway upload command evidence remains PARTIAL/UNPROVEN until Tauri invoke, HTTP gateway mapping, Station ingest path, and Desktop API wrapper are all present.",
                "sourceArtifact": str(output),
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": PHASE,
                "sourceBom": BOM,
                "sourceSpec": SPEC,
                "sourceGate": GATE,
                "evidenceDetails": [gateway_upload_source],
                "recommended_review_commands": recommended_review_commands(),
                "recommendedReviewCommands": recommended_review_commands(),
            }
        )
    return issues


def recommended_review_commands() -> list[dict[str, str]]:
    return [
        {"purpose": "Run Station frontend telemetry local tests.", "command": "cd apps/station && go test ./app/subserver/frontend_telemetry"},
        {"purpose": "Run Desktop telemetry envelope and bounded queue tests.", "command": "pnpm --dir apps/desktop exec vitest run src/kernel/frontendTelemetry.test.ts"},
        {"purpose": "Run Tauri/Gateway upload validation tests.", "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml frontend_telemetry"},
        {"purpose": "Run full Phase 0 acceptance.", "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"},
    ]


def build_report(
    output: Path,
    checks: list[dict[str, Any]],
    gateway_upload_source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if gateway_upload_source is None:
        gateway_upload_source = {
            "sourceKind": "desktop-gateway-frontend-telemetry-upload-source",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "failedRequirementCount": len(GATEWAY_UPLOAD_SOURCE_REQUIREMENTS),
            "failedRequirements": [str(requirement["id"]) for requirement in GATEWAY_UPLOAD_SOURCE_REQUIREMENTS],
            "requirements": [],
        }
    passed = [check for check in checks if check.get("status") == "pass"]
    failed = [check for check in checks if check.get("status") != "pass"]
    source_proven = gateway_upload_source.get("proofStatus") == "PROVEN"
    status = "pass" if not failed and len(passed) == len(CHECKS) and source_proven else "diagnostic incomplete"
    issues = issue_breakdown(output, checks, gateway_upload_source)
    return {
        "artifactKind": ARTIFACT_KIND,
        "schemaVersion": 1,
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "sourceArtifact": str(output),
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "sampleEmissionAllowed": False,
        "checks": checks,
        "gatewayUploadSourceEvidence": gateway_upload_source,
        "summary": {
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "checkCount": len(checks),
            "passedCheckCount": len(passed),
            "failedCheckCount": len(failed),
            "stationIngestQueryRollupStatus": next((c.get("status") for c in checks if c.get("id") == "station-ingest-query-rollup"), None),
            "desktopEnvelopeBoundedQueueStatus": next((c.get("status") for c in checks if c.get("id") == "desktop-envelope-bounded-queue"), None),
            "tauriGatewayUploadValidationStatus": next((c.get("status") for c in checks if c.get("id") == "tauri-gateway-upload-validation"), None),
            "gatewayUploadSourceStatus": gateway_upload_source.get("status"),
            "gatewayUploadSourceProofStatus": gateway_upload_source.get("proofStatus"),
            "gatewayUploadSourceFailedRequirementCount": gateway_upload_source.get("failedRequirementCount"),
            "gatewayUploadSourceFailedRequirements": gateway_upload_source.get("failedRequirements") or [],
            "sampleEmissionAllowed": False,
        },
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "recommended_review_commands": recommended_review_commands(),
        "recommendedReviewCommands": recommended_review_commands(),
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Telemetry Local Loop Gate",
        "",
        f"- status: `{report['status']}`",
        f"- completionStatus: `{report['completionStatus']}`",
        f"- proofStatus: `{report['proofStatus']}`",
        f"- phase: `{report['phase']}`",
        f"- bom: `{','.join(report['bom'])}`",
        f"- spec: `{','.join(report['spec'])}`",
        f"- sampleEmissionAllowed: `{report['sampleEmissionAllowed']}`",
        f"- gatewayUploadSourceStatus: `{report['summary'].get('gatewayUploadSourceStatus')}`",
        f"- gatewayUploadSourceProofStatus: `{report['summary'].get('gatewayUploadSourceProofStatus')}`",
        "",
        "## Checks",
        "",
    ]
    for check in report["checks"]:
        lines.append(
            f"- `{check['id']}` status=`{check['status']}` proof=`{check['proofStatus']}` phase=`{check.get('phase')}` bom=`{','.join(check.get('bom') or [])}` spec=`{','.join(check.get('spec') or [])}` command=`{check['command']}`"
        )
    lines.extend(["", "## Gateway Upload Source"])
    for requirement in report.get("gatewayUploadSourceEvidence", {}).get("requirements", []):
        if not isinstance(requirement, dict):
            continue
        lines.append(
            f"- `{requirement.get('id')}` status=`{requirement.get('status')}` proof=`{requirement.get('proofStatus')}` path=`{requirement.get('path')}`"
        )
    if report["issueBreakdown"]:
        lines.extend(["", "## Issues"])
        for issue in report["issueBreakdown"]:
            lines.append(f"- `{issue['category']}` failedStep=`{issue['failedStep']}` summary={issue['summary']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--root", default=".")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output = Path(args.output)
    checks = [run_check(root, spec, args.timeout) for spec in CHECKS]
    report = build_report(output, checks, gateway_upload_source_evidence(root))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")
    print(f"[desktop-telemetry-local-loop-gate] wrote {output}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
