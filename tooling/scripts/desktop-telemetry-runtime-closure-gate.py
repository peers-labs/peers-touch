#!/usr/bin/env python3
"""Generate fail-closed P0a Station runtime dependency closure evidence."""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ARTIFACT_KIND = "desktop-telemetry-runtime-closure-gate"
PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
BOM = ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"]
SPEC = ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"]
GATE = (
    "P0a Station runtime proof must use a managed Station+Postgres dependency closure before "
    "Gateway upload, route probe, query, rollup, mirror, or runtime sample emission can be trusted"
)
DEFAULT_OUTPUT = Path("tooling/acceptance/reports/desktop-telemetry-runtime-closure-gate.json")
STATION_DEV_PATH = Path("tooling/scripts/local-dev/station-dev.sh")
STORE_LOCAL_PATH = Path("apps/station/app/conf/store.local.yml")
COMPOSE_PATH = Path("tooling/docker/compose.yml")
COMPOSE_ENV_PATH = Path("tooling/docker/.env")

COMPOSE_CONTRACT_TOKENS = [
    "postgres:",
    "profiles: [infra]",
    "station:",
    "PEERS_DB_DSN: host=postgres",
    "depends_on:",
    "condition: service_healthy",
    "${STATION_PORT:-18080}:18080",
]
FAILED_STEP = "runtime.closure"
BLOCKED_STEP = "gateway.frontend_telemetry_upload"
BLOCKED_PHASE = "P0a-3"
BLOCKED_DOWNSTREAM_STEPS = [
    "preflight.gateway_station",
    "gateway.auth_login",
    "station.auth_login",
    "station.telemetry_routes",
    "gateway.frontend_telemetry_upload",
    "station.raw_query",
    "station.rollup_query",
    "dev_mirror",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def run_command(command: list[str], timeout: float) -> dict[str, Any]:
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        return {"command": command, "status": "diagnostic incomplete", "proofStatus": "UNPROVEN", "reason": str(exc)}
    except subprocess.TimeoutExpired:
        return {
            "command": command,
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": f"command timed out after {timeout}s",
        }
    stdout_lines = completed.stdout.strip().splitlines()[:20] if completed.stdout.strip() else []
    stderr_lines = completed.stderr.strip().splitlines()[:20] if completed.stderr.strip() else []
    output = (completed.stdout + completed.stderr).strip()
    output_lines = output.splitlines()[:20]
    failure_detail = next((line for line in stderr_lines + stdout_lines if line.strip()), "")
    return {
        "command": command,
        "exitCode": completed.returncode,
        "status": "pass" if completed.returncode == 0 else "diagnostic incomplete",
        "proofStatus": "PROVEN" if completed.returncode == 0 else "UNPROVEN",
        "stdout": stdout_lines,
        "stderr": stderr_lines,
        "output": output_lines,
        "reason": None
        if completed.returncode == 0
        else f"command exited {completed.returncode}: {failure_detail}"
        if failure_detail
        else f"command exited {completed.returncode}",
    }


def local_station_entrypoint_evidence(root: Path) -> dict[str, Any]:
    path = root / STATION_DEV_PATH
    text = read_text(path)
    starts_go_station = "go run ." in text
    passes_managed_dsn = "PEERS_DB_DSN" in text
    starts_postgres = "postgres" in text and "docker compose" in text
    delegates_compose_closure = (
        "docker compose" in text
        and "--profile infra" in text
        and "--profile station" in text
        and "postgres station" in text
    )
    managed = delegates_compose_closure or (starts_go_station and (passes_managed_dsn or starts_postgres))
    return {
        "name": "local-dev-station-entrypoint",
        "path": str(STATION_DEV_PATH),
        "status": "pass" if managed else "diagnostic incomplete",
        "proofStatus": "PROVEN" if managed else "UNPROVEN",
        "startsGoStation": starts_go_station,
        "passesManagedDbDsn": passes_managed_dsn,
        "startsManagedPostgres": starts_postgres,
        "delegatesComposeClosure": delegates_compose_closure,
        "reason": "local station entrypoint carries its own managed DB closure"
        if managed
        else "local station entrypoint starts Station without provisioning PostgreSQL or passing a managed DB DSN",
    }


def local_store_dsn_evidence(root: Path, local_entrypoint: dict[str, Any]) -> dict[str, Any]:
    path = root / STORE_LOCAL_PATH
    text = read_text(path)
    delegates_compose_closure = bool(local_entrypoint.get("delegatesComposeClosure"))
    uses_unmanaged_localhost = "host=localhost" in text and "port=15432" in text
    proven = delegates_compose_closure or not uses_unmanaged_localhost
    return {
        "name": "local-dev-store-dsn",
        "path": str(STORE_LOCAL_PATH),
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "usesUnmanagedLocalhostPostgres": uses_unmanaged_localhost,
        "coveredByComposeClosure": delegates_compose_closure,
        "reason": "make station delegates to compose-managed Station+Postgres, so store.local.yml is not the runtime DSN source"
        if delegates_compose_closure
        else "store.local.yml points Station stores at host localhost:15432, which make station does not manage"
        if uses_unmanaged_localhost
        else "store.local.yml does not point Station stores at unmanaged localhost:15432",
    }


def compose_contract_evidence(root: Path) -> dict[str, Any]:
    path = root / COMPOSE_PATH
    text = read_text(path)
    present = [token for token in COMPOSE_CONTRACT_TOKENS if token in text]
    missing = [token for token in COMPOSE_CONTRACT_TOKENS if token not in present]
    return {
        "name": "compose-station-postgres-contract",
        "path": str(COMPOSE_PATH),
        "status": "pass" if not missing else "diagnostic incomplete",
        "proofStatus": "PROVEN" if not missing else "UNPROVEN",
        "requiredTokenCount": len(COMPOSE_CONTRACT_TOKENS),
        "presentTokenCount": len(present),
        "missingTokens": missing,
        "reason": "compose.yml defines Station with bridge-internal PostgreSQL and health dependency"
        if not missing
        else "compose.yml does not prove a Station+Postgres managed closure",
    }


def compose_env_evidence(root: Path) -> dict[str, Any]:
    path = root / COMPOSE_ENV_PATH
    exists = path.exists()
    text = read_text(path)
    required = ["PEERS_AUTH_SECRET", "PEERS_DB_PASSWORD"]
    present = [token for token in required if token in text]
    missing = [token for token in required if token not in present]
    proven = exists and not missing
    return {
        "name": "compose-env",
        "path": str(COMPOSE_ENV_PATH),
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "exists": exists,
        "missingTokens": missing,
        "reason": "tooling/docker/.env contains required compose Station secrets placeholders"
        if proven
        else "tooling/docker/.env is missing or lacks variables required by compose Station",
    }


def docker_client_evidence(timeout: float) -> dict[str, Any]:
    docker = run_command(["docker", "--version"], timeout)
    compose = run_command(["docker", "compose", "version"], timeout)
    proven = docker["proofStatus"] == "PROVEN" and compose["proofStatus"] == "PROVEN"
    return {
        "name": "docker-client",
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "docker": docker,
        "compose": compose,
        "reason": "Docker CLI and Compose plugin are available"
        if proven
        else "Docker CLI or Compose plugin is unavailable",
    }


def docker_daemon_evidence(timeout: float) -> dict[str, Any]:
    result = run_command(["docker", "info", "--format", "{{json .ServerVersion}}"], timeout)
    result.update(
        {
            "name": "docker-daemon",
            "reason": "Docker daemon is ready"
            if result["proofStatus"] == "PROVEN"
            else result.get("reason") or "Docker daemon is not ready",
        }
    )
    return result


def compose_config_evidence(root: Path, timeout: float) -> dict[str, Any]:
    result = run_command(
        [
            "docker",
            "compose",
            "-f",
            str(root / COMPOSE_PATH),
            "--env-file",
            str(root / COMPOSE_ENV_PATH),
            "--profile",
            "station",
            "--profile",
            "infra",
            "config",
            "--services",
        ],
        timeout,
    )
    services = "\n".join(result.get("output", []))
    has_services = "postgres" in services and "station" in services
    proven = result["proofStatus"] == "PROVEN" and has_services
    return {
        "name": "compose-config",
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "command": result["command"],
        "exitCode": result.get("exitCode"),
        "output": result.get("output", []),
        "hasPostgresService": "postgres" in services,
        "hasStationService": "station" in services,
        "reason": "compose config resolves station and postgres services"
        if proven
        else result.get("reason") or "compose config did not resolve both station and postgres services",
    }


def recommended_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Inspect why local make station is not a managed Station+Postgres closure.",
            "command": "rg -n 'go run|PEERS_DB_DSN|postgres|store.local|PT_STATION_DB_NAME' tooling/scripts/local-dev apps/station/app/conf",
        },
        {
            "purpose": "Inspect compose Station+Postgres managed dependency contract.",
            "command": "docker compose -f tooling/docker/compose.yml --env-file tooling/docker/.env --profile station --profile infra config --services",
        },
        {
            "purpose": "Check whether Docker daemon is ready before using compose as the managed runtime closure.",
            "command": "docker info",
        },
        {
            "purpose": "Re-run runtime closure gate before route probe and live telemetry gates.",
            "command": "python3 tooling/scripts/desktop-telemetry-runtime-closure-gate.py",
        },
    ]


def source_issue(category: str, summary: str, details: list[dict[str, Any]], output: Path) -> dict[str, Any]:
    return {
        "category": category,
        "failedStep": FAILED_STEP,
        "status": "diagnostic incomplete",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "summary": summary,
        "proofImpact": (
            "P0a remains PARTIAL/UNPROVEN and sampleEmissionAllowed=false until one managed "
            "Station+Postgres runtime closure is proven."
        ),
        "sourceArtifact": str(output),
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "details": details,
        "evidenceDetails": details,
        "recommended_review_commands": recommended_review_commands(),
        "recommendedReviewCommands": recommended_review_commands(),
    }


def blocked_downstream_proofs(
    *,
    sample_allowed: bool,
    output: Path,
    reason: str,
    failed_check_reasons: dict[str, Any],
) -> list[dict[str, Any]]:
    if sample_allowed:
        return []
    return [
        {
            "step": step,
            "status": "blocked",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "blockedByStep": FAILED_STEP,
            "blockedByPhase": PHASE,
            "blockedByGate": GATE,
            "reason": reason,
            "failedCheckReasons": failed_check_reasons,
            "sourceArtifact": str(output),
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
        }
        for step in BLOCKED_DOWNSTREAM_STEPS
    ]


def build_report(root: Path, output: Path, timeout: float) -> dict[str, Any]:
    local_entrypoint = local_station_entrypoint_evidence(root)
    local_store_dsn = local_store_dsn_evidence(root, local_entrypoint)
    compose_contract = compose_contract_evidence(root)
    compose_env = compose_env_evidence(root)
    docker_client = docker_client_evidence(timeout)
    compose_config = compose_config_evidence(root, timeout)
    docker_daemon = docker_daemon_evidence(timeout)

    local_entrypoint_delegates_compose = bool(local_entrypoint.get("delegatesComposeClosure"))
    local_closure_proven = (
        not local_entrypoint_delegates_compose
        and local_entrypoint["proofStatus"] == "PROVEN"
        and local_store_dsn["proofStatus"] == "PROVEN"
    )
    compose_closure_proven = all(
        check["proofStatus"] == "PROVEN"
        for check in (compose_contract, compose_env, docker_client, compose_config, docker_daemon)
    )
    sample_allowed = local_closure_proven or compose_closure_proven
    checks = [local_entrypoint, local_store_dsn, compose_contract, compose_env, docker_client, compose_config, docker_daemon]

    issues: list[dict[str, Any]] = []
    if not sample_allowed:
        local_failed = [
            check
            for check in (local_entrypoint, local_store_dsn)
            if check["proofStatus"] != "PROVEN" or not local_entrypoint_delegates_compose
        ]
        if local_failed:
            issues.append(
                source_issue(
                    "local-dev-station-runtime-closure-unproven",
                    "local make station does not prove a managed Station+Postgres closure.",
                    local_failed,
                    output,
                )
            )
        issues.append(
            source_issue(
                "compose-station-runtime-closure-unproven",
                "compose Station+Postgres closure is not currently ready for runtime proof.",
                [compose_contract, compose_env, docker_client, compose_config, docker_daemon],
                output,
            )
        )

    status = "pass" if sample_allowed else "diagnostic incomplete"
    managed_runtime = "local-dev-station" if local_closure_proven else "compose-station-postgres" if compose_closure_proven else None
    failed_checks = [check for check in checks if check["proofStatus"] != "PROVEN"]
    local_failed_checks = [check["name"] for check in (local_entrypoint, local_store_dsn) if check["proofStatus"] != "PROVEN"]
    compose_failed_checks = [
        check["name"]
        for check in (compose_contract, compose_env, docker_client, compose_config, docker_daemon)
        if check["proofStatus"] != "PROVEN"
    ]
    check_reasons = {check["name"]: check.get("reason") for check in checks}
    failed_check_reasons = {check["name"]: check.get("reason") for check in failed_checks}
    local_runtime_closure = {
        "proofStatus": "PROVEN" if local_closure_proven else "UNPROVEN",
        "sampleEmissionAllowed": local_closure_proven,
        "failedChecks": local_failed_checks,
        "failedCheckReasons": {
            check["name"]: check.get("reason")
            for check in (local_entrypoint, local_store_dsn)
            if check["proofStatus"] != "PROVEN"
        },
        "checks": [local_entrypoint["name"], local_store_dsn["name"]],
    }
    compose_runtime_closure = {
        "proofStatus": "PROVEN" if compose_closure_proven else "UNPROVEN",
        "sampleEmissionAllowed": compose_closure_proven,
        "failedChecks": compose_failed_checks,
        "failedCheckReasons": {
            check["name"]: check.get("reason")
            for check in (compose_contract, compose_env, docker_client, compose_config, docker_daemon)
            if check["proofStatus"] != "PROVEN"
        },
        "checks": [
            compose_contract["name"],
            compose_env["name"],
            docker_client["name"],
            compose_config["name"],
            docker_daemon["name"],
        ],
    }
    reason = (
        "managed Station+Postgres runtime closure is proven"
        if sample_allowed
        else "managed Station+Postgres runtime closure is not proven; P0a live sample emission remains blocked"
    )
    downstream_proofs = blocked_downstream_proofs(
        sample_allowed=sample_allowed,
        output=output,
        reason=reason,
        failed_check_reasons=failed_check_reasons,
    )
    return {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if sample_allowed else "PARTIAL",
        "proofStatus": "PROVEN" if sample_allowed else "UNPROVEN",
        "failedStep": None if sample_allowed else FAILED_STEP,
        "reason": reason,
        "blockedStep": None if sample_allowed else BLOCKED_STEP,
        "blockedPhase": None if sample_allowed else BLOCKED_PHASE,
        "blockedByStep": None if sample_allowed else FAILED_STEP,
        "blockedByPhase": None if sample_allowed else PHASE,
        "blockedByGate": None if sample_allowed else GATE,
        "blockedDownstreamSteps": [] if sample_allowed else BLOCKED_DOWNSTREAM_STEPS,
        "blockedDownstreamProofs": downstream_proofs,
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
        "sampleEmissionAllowed": sample_allowed,
        "managedRuntimeClosure": managed_runtime,
        "checks": checks,
        "details": failed_checks,
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "recommended_review_commands": recommended_review_commands(),
        "recommendedReviewCommands": recommended_review_commands(),
        "summary": {
            "status": status,
            "completionStatus": "DONE" if sample_allowed else "PARTIAL",
            "proofStatus": "PROVEN" if sample_allowed else "UNPROVEN",
            "sampleEmissionAllowed": sample_allowed,
            "managedRuntimeClosure": managed_runtime,
            "failedStep": None if sample_allowed else FAILED_STEP,
            "reason": reason,
            "blockedStep": None if sample_allowed else BLOCKED_STEP,
            "blockedPhase": None if sample_allowed else BLOCKED_PHASE,
            "blockedByStep": None if sample_allowed else FAILED_STEP,
            "blockedByPhase": None if sample_allowed else PHASE,
            "blockedByGate": None if sample_allowed else GATE,
            "blockedDownstreamSteps": [] if sample_allowed else BLOCKED_DOWNSTREAM_STEPS,
              "blockedDownstreamProofs": downstream_proofs,
            "localRuntimeClosureProofStatus": "PROVEN" if local_closure_proven else "UNPROVEN",
            "composeRuntimeClosureProofStatus": "PROVEN" if compose_closure_proven else "UNPROVEN",
            "dockerDaemonProofStatus": docker_daemon["proofStatus"],
            "failedCheckCount": len(failed_checks),
            "failedChecks": [check["name"] for check in failed_checks],
            "checkReasons": check_reasons,
            "failedCheckReasons": failed_check_reasons,
            "localFailedChecks": local_failed_checks,
            "composeFailedChecks": compose_failed_checks,
            "localRuntimeClosure": local_runtime_closure,
            "composeRuntimeClosure": compose_runtime_closure,
        },
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Telemetry Runtime Closure Gate",
        "",
        f"- status: `{report['status']}`",
        f"- completionStatus: `{report['completionStatus']}`",
        f"- proofStatus: `{report['proofStatus']}`",
        f"- failedStep: `{report.get('failedStep')}`",
        f"- reason: `{report.get('reason')}`",
        f"- sampleEmissionAllowed: `{str(report['sampleEmissionAllowed']).lower()}`",
        f"- managedRuntimeClosure: `{report.get('managedRuntimeClosure') or 'none'}`",
        f"- blockedStep: `{report.get('blockedStep')}`",
        f"- blockedByStep: `{report.get('blockedByStep')}`",
        f"- blockedDownstreamSteps: `{','.join(report.get('blockedDownstreamSteps') or [])}`",
        f"- blockedDownstreamProofCount: `{len(report.get('blockedDownstreamProofs') or [])}`",
        f"- phase: `{report['phase']}`",
        f"- bom: `{','.join(report['bom'])}`",
        f"- spec: `{','.join(report['spec'])}`",
        f"- gate: `{report['gate']}`",
        "",
        "## Checks",
    ]
    for check in report["checks"]:
        lines.append(
            "- `{name}` status=`{status}` proof=`{proof}` reason=`{reason}`".format(
                name=check["name"],
                status=check["status"],
                proof=check["proofStatus"],
                reason=check.get("reason", "n/a"),
            )
        )
    if report["issueBreakdown"]:
        lines.extend(["", "## Issues"])
        for issue in report["issueBreakdown"]:
            lines.append(f"- `{issue['category']}`: {issue['summary']} impact={issue['proofImpact']}")
    if report.get("blockedDownstreamProofs"):
        lines.extend(["", "## Blocked Downstream Proofs"])
        for proof in report["blockedDownstreamProofs"]:
            lines.append(
                "- `{step}` status=`{status}` proof=`{proof}` blockedBy=`{blocked_by}` sourceArtifact=`{artifact}`".format(
                    step=proof["step"],
                    status=proof["status"],
                    proof=proof["proofStatus"],
                    blocked_by=proof["blockedByStep"],
                    artifact=proof["sourceArtifact"],
                )
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output = Path(args.output)
    report = build_report(root, output, args.timeout)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")
    print(f"[desktop-telemetry-runtime-closure-gate] wrote {output}")
    print(f"status: {report['status']} sampleEmissionAllowed={report['sampleEmissionAllowed']}")
    return 0 if report["proofStatus"] == "PROVEN" else 1


if __name__ == "__main__":
    raise SystemExit(main())
