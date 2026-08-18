#!/usr/bin/env python3
"""Run acceptance gates from the current plan or explicit gate ids."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

RUN_ARTIFACT_KIND = "acceptance-run"
RESULT_ARTIFACT_KIND = "acceptance-gate-result"
RESULT_TRACEABILITY_FIELDS = ("sourceArtifact", "sourceArtifactKind", "sourcePhase", "sourceBom", "sourceSpec", "sourceGate")
AGENT_V2_SCHEMA_ROOT = REPO_ROOT / "tooling/acceptance/schemas/agent-v2"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_agent_v2_contract() -> dict[str, Any]:
    return json.loads(
        (AGENT_V2_SCHEMA_ROOT / "contract.json").read_text(encoding="utf-8")
    )


def schema_descriptor(
    contract: dict[str, Any],
    schema_name: str,
) -> dict[str, Any]:
    definition = contract["schemas"][schema_name]
    schema_path = AGENT_V2_SCHEMA_ROOT / definition["file"]
    return {
        "id": definition["id"],
        "version": definition["version"],
        "sha256": sha256_file(schema_path),
    }


def matrix_identity(contract: dict[str, Any]) -> dict[str, Any]:
    matrix = dict(contract["matrix"])
    source_path = REPO_ROOT / matrix.pop("source")
    if not source_path.is_file() or sha256_file(source_path) != matrix["sha256"]:
        raise RuntimeError("reviewed Agent V2 runtime matrix hash mismatch")
    return matrix


def write_explicit_json(path_value: str, value: dict[str, Any]) -> None:
    from tooling.acceptance.core import validate_external_output_path

    path = validate_external_output_path(path_value, repo_root=REPO_ROOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def emit_agent_v2_candidate_metadata(
    gate_run: Any,
    gate_id: str,
    source: dict[str, Any],
) -> None:
    contract = load_agent_v2_contract()
    gate_contract = contract["gates"].get(gate_id)
    if gate_contract is None:
        raise RuntimeError(f"{gate_id}: missing Agent V2 proof contract")
    matrix = matrix_identity(contract)
    source_schema = schema_descriptor(contract, "source-identity")
    runner_schema = schema_descriptor(contract, "runner-attestation")
    gate_run.write_json(
        "proof/source-identity.json",
        {
            "artifactKind": "agent-v2-source-identity",
            "schema": source_schema,
            "role": "source-identity",
            "gateId": gate_id,
            "runId": gate_run.run_id,
            "sourceIdentity": source,
            "runtimeMatrix": matrix,
        },
        role="source-identity",
        redact=False,
    )
    gate_run.write_json(
        "proof/runner-attestation.json",
        {
            "artifactKind": "agent-v2-runner-attestation",
            "schema": runner_schema,
            "role": "runner-attestation",
            "gateId": gate_id,
            "runId": gate_run.run_id,
            "producer": {
                "kind": "runner",
                "processId": os.getpid(),
                "invocationId": secrets.token_hex(16),
            },
            "candidateOnly": True,
            "attestedAt": utc_now(),
        },
        role="runner-attestation",
        redact=False,
    )
    role_schemas: dict[str, Any] = {}
    for role in gate_contract["roles"]:
        schema_name = (
            role
            if role in contract["schemas"]
            else "evidence-role"
        )
        role_schemas[role] = schema_descriptor(contract, schema_name)
    report_schema = schema_descriptor(contract, "role-schema-report")
    gate_run.write_json(
        "proof/role-schema-report.json",
        {
            "artifactKind": "agent-v2-role-schema-report",
            "schema": report_schema,
            "role": "role-schema-report",
            "gateId": gate_id,
            "runId": gate_run.run_id,
            "schemas": role_schemas,
        },
        role="role-schema-report",
        redact=False,
    )


@contextlib.contextmanager
def run_environment(environment: dict[str, str]):
    keys = (
        "PT_ACCEPTANCE_ARTIFACT_ROOT",
        "PT_ACCEPTANCE_WORKSPACE_ID",
        "PT_ACCEPTANCE_GATE_ID",
        "PT_ACCEPTANCE_RUN_ID",
    )
    previous = {key: os.environ.get(key) for key in keys}
    os.environ.update({key: environment[key] for key in keys})
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def provision_environment(
    environment_id: str,
    gate_id: str,
) -> tuple[Any | None, dict[str, Any] | None, Path | None]:
    if environment_id == "local":
        return None, None, None

    from tooling.acceptance.core import (
        ENVIRONMENTS_DIR,
        EnvironmentContract,
        blocked_manifest,
        current_artifact_ref,
        write_current_artifact,
        new_manifest,
    )
    from tooling.acceptance.provisioners import get_provisioner

    contract_path = ENVIRONMENTS_DIR / f"{environment_id}.yaml"
    if not contract_path.exists():
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip() or "unknown"
        base = new_manifest(
            environment_id=environment_id,
            gate_id=gate_id,
            requested_profile="unknown",
            resolved_profile="unknown",
            slot=0,
            commit=commit,
            worktree=str(REPO_ROOT),
        )
        manifest = blocked_manifest(
            base,
            reason=(
                f"Environment {environment_id!r} has no provisioning contract "
                f"at {contract_path}"
            ),
            resource=f"environment-contract:{environment_id}",
        )
        manifest_path = write_current_artifact(
            "runtime/environment-manifest.json",
            (
                json.dumps(manifest.to_dict(), indent=2, sort_keys=True) + "\n"
            ).encode("utf-8"),
            repo_root=REPO_ROOT,
        )
        manifest_dict = manifest.to_dict()
        manifest_dict["_manifest_ref"] = current_artifact_ref(
            "runtime/environment-manifest.json",
            repo_root=REPO_ROOT,
        ).to_dict()
        return None, manifest_dict, manifest_path

    contract = EnvironmentContract.from_yaml(contract_path)
    provisioner = get_provisioner(contract)
    manifest = provisioner.provision(gate_id)
    manifest_dict = manifest.to_dict()
    manifest_path = provisioner.write_manifest()
    manifest_dict["_manifest_ref"] = current_artifact_ref(
        "runtime/environment-manifest.json",
        repo_root=REPO_ROOT,
    ).to_dict()
    return provisioner, manifest_dict, manifest_path


def credential_values(manifest: dict[str, Any] | None) -> tuple[str, ...]:
    if not manifest:
        return ()
    from tooling.acceptance.core import CredentialRef

    values: list[str] = []
    refs = manifest.get("credentialRefs")
    if not isinstance(refs, list):
        return ()
    for index, source_ref in enumerate(refs):
        if not isinstance(source_ref, str):
            continue
        try:
            value = CredentialRef(
                id=f"runtime-{index}",
                source_ref=source_ref,
            ).resolve()
        except Exception:
            continue
        if value:
            values.append(value)
    return tuple(values)


def redact_runtime_text(
    text: str,
    secret_values: tuple[str, ...],
) -> str:
    from tooling.acceptance.core.redaction import REDACTED, redact_text

    redacted = redact_text(text)
    for value in secret_values:
        if len(value) >= 4:
            redacted = redacted.replace(value, REDACTED)
    return redacted


def redact_runtime_artifacts(
    run_dir: Path,
    secret_values: tuple[str, ...],
) -> tuple[list[str], list[str]]:
    redacted_paths: list[str] = []
    leaked_paths: list[str] = []
    protected_paths: set[str] = set()
    role_directory = run_dir / ".artifact-roles"
    if role_directory.is_dir():
        for metadata_path in role_directory.glob("*.json"):
            try:
                metadata = json.loads(
                    metadata_path.read_text(encoding="utf-8")
                )
                artifact_path = metadata["artifact"]["path"]
            except (OSError, KeyError, TypeError, json.JSONDecodeError):
                continue
            if isinstance(artifact_path, str):
                protected_paths.add(artifact_path)
    high_entropy_values = tuple(
        value for value in secret_values if len(value) >= 16
    )
    for path in run_dir.rglob("*"):
        if (
            not path.is_file()
            or any(part.startswith(".") for part in path.relative_to(run_dir).parts)
        ):
            continue
        try:
            original = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        relative_path = path.relative_to(run_dir).as_posix()
        if any(value in original for value in high_entropy_values):
            leaked_paths.append(relative_path)
        if relative_path in protected_paths:
            continue
        try:
            payload = json.loads(original)
        except json.JSONDecodeError:
            redacted = redact_runtime_text(original, secret_values)
        else:
            from tooling.acceptance.core.redaction import redact_value

            redacted = (
                json.dumps(
                    redact_value(payload),
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n"
            )
            redacted = redact_runtime_text(redacted, secret_values)
        if redacted != original:
            path.write_text(redacted, encoding="utf-8")
            redacted_paths.append(relative_path)
    return sorted(redacted_paths), sorted(leaked_paths)


def provisioning_failure_result(
    *,
    gate_id: str,
    command: str,
    environment: str,
    tier: str,
    error: Exception,
    duration_seconds: float,
) -> dict[str, Any]:
    from tooling.acceptance.core.redaction import redact_text

    return {
        "id": gate_id,
        "command": command,
        "environment": environment,
        "tier": tier,
        "status": "failed",
        "exit_code": None,
        "duration_seconds": duration_seconds,
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "reason": redact_text(str(error)),
        "errorType": type(error).__name__,
        "sourceArtifact": "tooling/acceptance/gates.yaml",
        "sourceArtifactKind": "acceptance-gate-catalog",
        "sourcePhase": "Runtime Provisioning",
        "sourceBom": ["WS2", "WS6"],
        "sourceSpec": ["D-07", "D-08"],
        "sourceGate": (
            "Provisioner errors must fail structurally before product Gate "
            "execution"
        ),
    }


def load_plan(
    path: Path | None,
    store: Any,
) -> tuple[dict[str, Any], Any]:
    if path is not None:
        if not path.is_file():
            raise SystemExit(f"acceptance plan {str(path)!r} does not exist")
        return json.loads(path.read_text(encoding="utf-8")), str(path)
    try:
        reference = store.latest_artifact_ref("acceptance-plan", "plan")
    except Exception:
        subprocess.run(
            ["python3", "tooling/scripts/acceptance-plan.py"],
            cwd=REPO_ROOT,
            check=True,
            env={
                **os.environ,
                "PT_ACCEPTANCE_ARTIFACT_ROOT": str(store.root),
            },
        )
        reference = store.latest_artifact_ref("acceptance-plan", "plan")
    return store.read_json(reference), reference.to_dict()


def load_gate_definitions(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")).get("gates", {})


def gate_from_definition(gate_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": gate_id,
        "command": definition["command"],
        "timeout_seconds": definition.get("timeout_seconds", 600),
        "environment": definition.get("environment", "local"),
        "provisioner": definition.get("provisioner", ""),
        "tier": definition.get("tier", "local-evidence"),
        "description": definition.get("description", ""),
        "required_by": ["manual"],
    }


def plan_gate_from_entry(entry: Any, definitions: dict[str, Any]) -> dict[str, Any]:
    if isinstance(entry, str):
        if entry not in definitions:
            raise SystemExit(f"gate {entry!r} is missing from gate definitions")
        return gate_from_definition(entry, definitions[entry])
    if not isinstance(entry, dict):
        raise SystemExit(f"plan selected_gates entry must be a gate id string or object: {entry!r}")
    gate_id = entry.get("id")
    if not isinstance(gate_id, str) or not gate_id:
        raise SystemExit(f"plan selected_gates object is missing id: {entry!r}")
    if "command" in entry:
        return dict(entry)
    if gate_id not in definitions:
        raise SystemExit(f"gate {gate_id!r} is missing from gate definitions")
    gate = gate_from_definition(gate_id, definitions[gate_id])
    gate.update(entry)
    return gate


def selected_gates_from_plan(plan: dict[str, Any], definitions: dict[str, Any]) -> list[dict[str, Any]]:
    return [plan_gate_from_entry(entry, definitions) for entry in plan.get("selected_gates", [])]


def filter_gates_by_tier(gates: list[dict[str, Any]], tiers: list[str]) -> list[dict[str, Any]]:
    if not tiers:
        return gates
    selected = set(tiers)
    return [gate for gate in gates if gate.get("tier", "local-evidence") in selected]


def load_json_artifact(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def evidence_summary_from_artifact(path: Any, artifact: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"path": path}
    for key in (
        "artifactKind",
        "status",
        "completionStatus",
        "proofStatus",
        "phase",
        "bom",
        "spec",
        "gate",
        "reason",
        "failedStep",
        "sampleEmissionAllowed",
    ):
        if key in artifact:
            summary[key] = artifact[key]
    details = artifact.get("details", artifact.get("evidenceDetails"))
    if isinstance(details, list):
        summary["details"] = details
        summary["evidenceDetails"] = details
    issue_breakdown = artifact.get("issue_breakdown", artifact.get("issueBreakdown"))
    if isinstance(issue_breakdown, list):
        summary["issue_breakdown"] = issue_breakdown
        summary["issueBreakdown"] = issue_breakdown
    review_commands = artifact.get("recommended_review_commands", artifact.get("recommendedReviewCommands"))
    if isinstance(review_commands, list):
        summary["recommended_review_commands"] = review_commands
        summary["recommendedReviewCommands"] = review_commands
    return summary


def reason_from_issue_breakdown(summary: dict[str, Any]) -> str | None:
    issues = summary.get("issue_breakdown", summary.get("issueBreakdown"))
    if not isinstance(issues, list):
        return None
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        reason = issue.get("summary")
        if isinstance(reason, str) and reason:
            return reason
    return None


def enrich_result_with_run_artifacts(
    result: dict[str, Any],
    run: Any,
) -> dict[str, Any]:
    artifacts: list[dict[str, Any]] = []
    for reference in run.collect_existing_artifacts().values():
        path = run.store.resolve(reference)
        if path.suffix.lower() != ".json":
            continue
        artifact = load_json_artifact(path)
        if artifact is None:
            continue
        artifacts.append(
            evidence_summary_from_artifact(reference.to_dict(), artifact)
        )
    if not artifacts:
        return result
    enriched = dict(result)
    enriched["evidenceArtifacts"] = artifacts
    primary = artifacts[0]
    enriched["sourceArtifact"] = primary.get("path")
    for source_key, target_key in (
        ("artifactKind", "sourceArtifactKind"),
        ("status", "evidenceStatus"),
        ("completionStatus", "completionStatus"),
        ("proofStatus", "proofStatus"),
        ("phase", "phase"),
        ("bom", "bom"),
        ("spec", "spec"),
        ("gate", "gate"),
        ("reason", "reason"),
        ("failedStep", "failedStep"),
        ("sampleEmissionAllowed", "sampleEmissionAllowed"),
    ):
        if source_key in primary:
            enriched[target_key] = primary[source_key]
    for source_key, target_key in (
        ("phase", "sourcePhase"),
        ("bom", "sourceBom"),
        ("spec", "sourceSpec"),
        ("gate", "sourceGate"),
    ):
        if source_key in primary:
            enriched[target_key] = primary[source_key]
    for key in (
        "details",
        "evidenceDetails",
        "issue_breakdown",
        "issueBreakdown",
        "recommended_review_commands",
        "recommendedReviewCommands",
    ):
        if key in primary:
            enriched[key] = primary[key]
    if not enriched.get("reason"):
        issue_reason = reason_from_issue_breakdown(primary)
        if issue_reason:
            enriched["reason"] = issue_reason
    return enriched


def dedupe_review_commands(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    seen: set[str] = set()
    for result in results:
        source_commands = result.get("recommended_review_commands", result.get("recommendedReviewCommands"))
        if not isinstance(source_commands, list):
            continue
        for command in source_commands:
            if not isinstance(command, dict):
                continue
            purpose = command.get("purpose")
            command_text = command.get("command")
            if not isinstance(purpose, str) or not isinstance(command_text, str):
                continue
            key = command_text
            if key in seen:
                continue
            seen.add(key)
            commands.append({"purpose": purpose, "command": command_text})
    return commands


def result_is_incomplete(result: dict[str, Any]) -> bool:
    if result.get("status") not in {"passed", "dry-run"}:
        return True
    if result.get("completionStatus") == "PARTIAL":
        return True
    return result.get("proofStatus") == "UNPROVEN"


def result_traceability(result: dict[str, Any]) -> dict[str, Any]:
    missing = [key for key in RESULT_TRACEABILITY_FIELDS if key not in result]
    incomplete = result_is_incomplete(result)
    if not missing:
        status = "complete"
        reason = "result preserves source artifact Phase/BOM/Spec/Gate traceability"
    elif incomplete:
        status = "missing"
        reason = "incomplete acceptance result is missing source artifact Phase/BOM/Spec/Gate traceability"
    else:
        status = "not-required"
        reason = "passed static/local gate does not emit a source evidence artifact"
    trace: dict[str, Any] = {
        "status": status,
        "missingFields": missing,
        "reason": reason,
    }
    for key in RESULT_TRACEABILITY_FIELDS:
        if key in result:
            trace[key] = result[key]
    return trace


def standardize_result(
    result: dict[str, Any],
    plan_path: Any,
    *,
    candidate_mode: bool = False,
) -> dict[str, Any]:
    standardized = dict(result)
    gate_id = str(standardized.get("id") or "unknown")
    status = str(standardized.get("status") or "")
    if candidate_mode:
        declared_proof = standardized.get("proofStatus")
        if (
            standardized.get("status") == "passed"
            and declared_proof != "UNPROVEN"
        ):
            standardized["proofStatus"] = "CANDIDATE"
        elif declared_proof == "PROVEN":
            standardized["proofStatus"] = "UNPROVEN"
    standardized.setdefault("artifactKind", RESULT_ARTIFACT_KIND)
    standardized.setdefault(
        "artifactPath",
        standardized.get("log")
        or standardized.get("sourceArtifact")
        or {"plan": plan_path, "resultGateId": gate_id},
    )
    standardized.setdefault("sampleEmissionAllowed", False)
    if status == "passed":
        standardized.setdefault("completionStatus", "DONE")
        standardized.setdefault("proofStatus", "PROVEN")
    elif status not in {"dry-run", "blocked"}:
        standardized.setdefault("completionStatus", "PARTIAL")
        standardized.setdefault("proofStatus", "UNPROVEN")
    standardized["traceability"] = result_traceability(standardized)
    return standardized


def run_issue_breakdown(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for result in results:
        if not result_is_incomplete(result):
            continue
        gate_id = str(result.get("id") or "unknown")
        source_artifact = result.get("sourceArtifact")
        source_artifact_kind = result.get("sourceArtifactKind")
        source_details = result.get("details", result.get("evidenceDetails"))
        source_trace = {
            key: result[key]
            for key in ("sourcePhase", "sourceBom", "sourceSpec", "sourceGate")
            if key in result
        }
        source_issues = result.get("issue_breakdown", result.get("issueBreakdown"))
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if not isinstance(issue, dict):
                    continue
                run_issue = {
                    "category": str(issue.get("category") or f"acceptance-gate:{gate_id}"),
                    "failedStep": str(issue.get("failedStep") or gate_id),
                    "status": str(issue.get("status") or result.get("evidenceStatus") or "diagnostic incomplete"),
                    "completionStatus": str(issue.get("completionStatus") or result.get("completionStatus") or "PARTIAL"),
                    "proofStatus": str(issue.get("proofStatus") or result.get("proofStatus") or "UNPROVEN"),
                    "sampleEmissionAllowed": issue.get("sampleEmissionAllowed")
                    if isinstance(issue.get("sampleEmissionAllowed"), bool)
                    else result.get("sampleEmissionAllowed") is True,
                    "summary": str(issue.get("summary") or result.get("reason") or "acceptance gate failed"),
                    "proofImpact": str(
                        issue.get("proofImpact")
                        or "Acceptance run remains PARTIAL/UNPROVEN until this gate passes."
                    ),
                    "acceptanceGateId": gate_id,
                }
                if isinstance(source_artifact, (str, dict)):
                    run_issue["sourceArtifact"] = source_artifact
                if isinstance(source_artifact_kind, str):
                    run_issue["sourceArtifactKind"] = source_artifact_kind
                run_issue.update(source_trace)
                if isinstance(source_details, list):
                    run_issue["details"] = source_details
                    run_issue["evidenceDetails"] = source_details
                issues.append(run_issue)
            continue
        run_issue = {
            "category": f"acceptance-gate:{gate_id}",
            "failedStep": gate_id,
            "status": str(result.get("evidenceStatus") or "diagnostic incomplete"),
            "completionStatus": str(result.get("completionStatus") or "PARTIAL"),
            "proofStatus": str(result.get("proofStatus") or "UNPROVEN"),
            "sampleEmissionAllowed": result.get("sampleEmissionAllowed") is True,
            "summary": str(result.get("reason") or "acceptance gate remains incomplete without source diagnostics"),
            "proofImpact": "Acceptance run remains PARTIAL/UNPROVEN until this gate emits proven source evidence.",
            "acceptanceGateId": gate_id,
        }
        if isinstance(source_artifact, (str, dict)):
            run_issue["sourceArtifact"] = source_artifact
        if isinstance(source_artifact_kind, str):
            run_issue["sourceArtifactKind"] = source_artifact_kind
        run_issue.update(source_trace)
        if isinstance(source_details, list):
            run_issue["details"] = source_details
            run_issue["evidenceDetails"] = source_details
        issues.append(run_issue)
    return issues


def unique_ordered(values: list[Any]) -> list[Any]:
    unique: list[Any] = []
    seen: set[str] = set()
    for value in values:
        key = json.dumps(value, sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def aggregate_source_values(results: list[dict[str, Any]], key: str) -> list[Any]:
    values: list[Any] = []
    for result in results:
        value = result.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            values.extend(value)
        else:
            values.append(value)
    return unique_ordered(values)


def missing_result_traceability_count(results: list[dict[str, Any]]) -> int:
    return sum(
        1
        for result in results
        if result.get("status") != "dry-run" and result.get("traceability", {}).get("status") == "missing"
    )


def result_traceability_state(
    results: list[dict[str, Any]],
    *,
    candidate_mode: bool = False,
) -> dict[str, Any]:
    missing = [
        {
            "acceptanceGateId": result.get("id"),
            "artifactKind": result.get("artifactKind"),
            "artifactPath": result.get("artifactPath"),
            **result.get("traceability", {}),
        }
        for result in results
        if result.get("status") != "dry-run" and result.get("traceability", {}).get("status") == "missing"
    ]
    status = "pass" if not missing else "diagnostic incomplete"
    return {
        "artifactKind": "acceptance-run-result-traceability-state",
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": (
            "CANDIDATE" if candidate_mode else "PROVEN"
        )
        if status == "pass"
        else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "missingTraceabilityCount": len(missing),
        "missingTraceability": missing,
    }


def build_run_report(
    plan_path: Any,
    results: list[dict[str, Any]],
    *,
    candidate_mode: bool = False,
) -> dict[str, Any]:
    results = [
        standardize_result(
            result,
            plan_path,
            candidate_mode=candidate_mode,
        )
        for result in results
    ]
    blocked = [result for result in results if result.get("status") == "blocked"]
    failed = [result for result in results if result.get("status") not in {"passed", "dry-run", "blocked"}]
    dry_run = [result for result in results if result.get("status") == "dry-run"]
    partial = [result for result in results if result.get("completionStatus") == "PARTIAL"]
    unproven = [result for result in results if result.get("proofStatus") == "UNPROVEN"]
    incomplete = [result for result in results if result_is_incomplete(result)]
    passed_but_unproven = [
        result for result in results if result.get("status") == "passed" and result.get("proofStatus") == "UNPROVEN"
    ]
    missing_traceability = missing_result_traceability_count(results)
    sample_emission_allowed = (
        bool(results)
        and not failed
        and not blocked
        and not dry_run
        and not partial
        and not unproven
        and not incomplete
        and missing_traceability == 0
    )
    report: dict[str, Any] = {
        "artifactKind": RUN_ARTIFACT_KIND,
        "plan": plan_path,
        "sourceArtifact": plan_path,
        "summary": {
            "total": len(results),
            "passed": len([result for result in results if result.get("status") == "passed"]),
            "failed": len(failed),
            "blocked": len(blocked),
            "dryRun": len(dry_run),
            "partial": len(partial),
            "unproven": len(unproven),
            "incomplete": len(incomplete),
            "passedButUnproven": len(passed_but_unproven),
            "missingResultTraceability": missing_traceability,
            "sampleEmissionAllowed": sample_emission_allowed,
        },
        "completionStatus": "BLOCKED" if blocked else ("DONE" if not incomplete else "PARTIAL"),
        "proofStatus": (
            ("CANDIDATE" if candidate_mode else "PROVEN")
            if not failed and not blocked and not unproven and not dry_run
            else "UNPROVEN"
        ),
        "sampleEmissionAllowed": sample_emission_allowed,
        "resultTraceabilityState": result_traceability_state(
            results,
            candidate_mode=candidate_mode,
        ),
        "results": results,
    }
    source_phases = aggregate_source_values(results, "sourcePhase")
    source_bom = aggregate_source_values(results, "sourceBom")
    source_spec = aggregate_source_values(results, "sourceSpec")
    source_gates = aggregate_source_values(results, "sourceGate")
    if source_phases:
        report["sourcePhases"] = source_phases
    if source_bom:
        report["sourceBom"] = source_bom
    if source_spec:
        report["sourceSpec"] = source_spec
    if source_gates:
        report["sourceGates"] = source_gates
    if incomplete:
        issue_breakdown = run_issue_breakdown(results)
        review_commands = dedupe_review_commands(results)
        report["issue_breakdown"] = issue_breakdown
        report["issueBreakdown"] = issue_breakdown
        if review_commands:
            report["recommended_review_commands"] = review_commands
            report["recommendedReviewCommands"] = review_commands
    return report


def render_markdown(report: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Acceptance Run",
            "",
            f"- Completion: `{report.get('completionStatus', 'UNKNOWN')}`",
            f"- Proof: `{report.get('proofStatus', 'UNKNOWN')}`",
            f"- Sample emission allowed: `{report.get('sampleEmissionAllowed', False)}`",
            "- Summary: "
            + json.dumps(report.get("summary", {}), ensure_ascii=False, sort_keys=True),
            "",
            "## Results",
            "",
            "| Gate | Status | Completion | Proof | Source kind |",
            "| --- | --- | --- | --- | --- |",
            *[
                "| {id} | {status} | {completion} | {proof} | {source_kind} |".format(
                    id=result.get("id", ""),
                    status=result.get("status", ""),
                    completion=result.get("completionStatus", ""),
                    proof=result.get("proofStatus", ""),
                    source_kind=result.get("sourceArtifactKind", ""),
                )
                for result in report.get("results", [])
                if isinstance(result, dict)
            ],
            "",
        ]
    )


def write_run_report(output: Path, report: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")


def acceptance_exit_code(
    report: dict[str, Any],
    *,
    candidate_mode: bool = False,
) -> int:
    if report.get("completionStatus") == "BLOCKED":
        return 2
    if report.get("completionStatus") != "DONE":
        return 1
    expected_proof = "CANDIDATE" if candidate_mode else "PROVEN"
    if report.get("proofStatus") != expected_proof:
        return 1
    if not candidate_mode and report.get("sampleEmissionAllowed") is not True:
        return 1
    return 0


def main() -> int:
    from tooling.acceptance.core import (
        EvidenceError,
        EvidenceStore,
        source_identity,
        validate_external_output_path,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--gates", default="tooling/acceptance/gates.yaml")
    parser.add_argument("--gate", action="append", default=[])
    parser.add_argument("--tier", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--candidate-ref-out")
    parser.add_argument("--candidate-manifest-sha-out")
    args = parser.parse_args()
    candidate_mode = bool(
        args.candidate_ref_out or args.candidate_manifest_sha_out
    )
    if candidate_mode and not (
        args.candidate_ref_out and args.candidate_manifest_sha_out
    ):
        raise SystemExit(
            "candidate handoff requires both --candidate-ref-out and "
            "--candidate-manifest-sha-out"
        )
    if candidate_mode and (args.dry_run or len(args.gate) != 1):
        raise SystemExit(
            "candidate handoff requires exactly one --gate and forbids --dry-run"
        )

    try:
        store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        plan, plan_source = load_plan(
            Path(args.plan) if args.plan else None,
            store,
        )
        aggregate_run = store.begin_run(
            "acceptance-run",
            source=source_identity(REPO_ROOT),
        )
    except EvidenceError as error:
        print(
            f"Acceptance evidence initialization failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1

    definitions = load_gate_definitions(Path(args.gates))
    gates = selected_gates_from_plan(plan, definitions)
    if args.gate:
        selected_by_id = {gate["id"]: gate for gate in gates}
        gates = []
        for gate_id in args.gate:
            if gate_id in selected_by_id:
                gates.append(selected_by_id[gate_id])
                continue
            if gate_id not in definitions:
                raise SystemExit(f"gate {gate_id!r} is missing from {args.gates}")
            gates.append(gate_from_definition(gate_id, definitions[gate_id]))
    gates = filter_gates_by_tier(gates, args.tier)

    results: list[dict[str, Any]] = []
    candidate_manifest_ref = None
    print("Acceptance Run")
    print("==============")
    if args.tier:
        print(f"tiers: {', '.join(args.tier)}")
    if not gates:
        print("[SKIP] no selected gates")

    active_gate_run = None
    try:
        for gate in gates:
            gate_id = gate["id"]
            command = gate["command"]
            timeout = int(gate.get("timeout_seconds") or 600)
            environment = gate.get("environment", "local")
            tier = gate.get("tier", "local-evidence")
            print(f"[RUN] {gate_id} [{tier}/{environment}]: {command}")
            started = time.time()

            if args.dry_run:
                results.append(
                    {
                        "id": gate_id,
                        "command": command,
                        "environment": environment,
                        "tier": tier,
                        "status": "dry-run",
                        "duration_seconds": 0,
                    }
                )
                continue

            gate_run = store.begin_run(
                gate_id,
                source=source_identity(REPO_ROOT),
            )
            active_gate_run = gate_run
            gate_env = gate_run.subprocess_environment(os.environ.copy())
            provisioner = None
            manifest = None
            manifest_path = None
            runtime_secrets: tuple[str, ...] = ()
            output_text = ""
            exit_code: int | None = None
            timed_out = False
            cleanup_status = "not-required"
            cleanup_error = ""
            result: dict[str, Any] | None = None
            try:
                provisioner_id = str(gate.get("provisioner") or "")
                if provisioner_id:
                    if provisioner_id != environment:
                        raise SystemExit(
                            f"gate {gate_id!r} provisioner {provisioner_id!r} "
                            f"does not match environment {environment!r}"
                        )
                    print(f"[PROVISION] {provisioner_id}")
                    try:
                        with run_environment(gate_env):
                            provisioner, manifest, manifest_path = provision_environment(
                                provisioner_id,
                                gate_id,
                            )
                    except EvidenceError:
                        raise
                    except Exception as error:
                        output_text = f"Provisioning failed: {type(error).__name__}: {error}\n"
                        result = provisioning_failure_result(
                            gate_id=gate_id,
                            command=command,
                            environment=environment,
                            tier=tier,
                            error=error,
                            duration_seconds=round(time.time() - started, 3),
                        )
                    if result is None and manifest and manifest.get("state") == "BLOCKED":
                        reason = manifest.get("blockedReason", "unknown")
                        resource = manifest.get("blockedResource", "")
                        output_text = f"BLOCKED: {reason} resource={resource}\n"
                        result = {
                            "id": gate_id,
                            "command": command,
                            "environment": environment,
                            "tier": tier,
                            "status": "blocked",
                            "exit_code": None,
                            "duration_seconds": round(time.time() - started, 3),
                            "blockedReason": reason,
                            "blockedResource": resource,
                            "manifest": manifest,
                            "completionStatus": "BLOCKED",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifact": manifest.get("_manifest_ref", {}),
                            "sourceArtifactKind": "acceptance-runtime-manifest",
                            "sourcePhase": "Runtime Provisioning",
                            "sourceBom": ["WS2", "WS6"],
                            "sourceSpec": ["D-07", "D-08"],
                            "sourceGate": (
                                "Environment must reach FIXTURE_READY before "
                                "product Gate execution"
                            ),
                        }
                    if result is None and manifest:
                        print(
                            f"[PROVISIONED] {environment} "
                            f"state={manifest.get('state')}"
                        )

                if result is None:
                    gate_env = gate_run.subprocess_environment(os.environ.copy())
                    gate_env["PT_ACCEPTANCE_CURRENT_RESULTS"] = json.dumps(
                        results,
                        ensure_ascii=False,
                    )
                    if manifest_path is not None:
                        gate_env["PT_ACCEPTANCE_RUNTIME_MANIFEST"] = str(
                            manifest_path
                        )
                    runtime_secrets = credential_values(manifest)
                    try:
                        completed = subprocess.run(
                            command,
                            shell=True,
                            text=True,
                            capture_output=True,
                            timeout=timeout,
                            env=gate_env,
                            cwd=REPO_ROOT,
                        )
                        output_text = completed.stdout + completed.stderr
                        exit_code = completed.returncode
                    except subprocess.TimeoutExpired as error:
                        timed_out = True
                        stdout = error.stdout or ""
                        stderr = error.stderr or ""
                        output_text = (
                            stdout.decode() if isinstance(stdout, bytes) else stdout
                        ) + (
                            stderr.decode() if isinstance(stderr, bytes) else stderr
                        )
                        output_text += f"\nGate timed out after {timeout} seconds\n"
            finally:
                if provisioner is not None:
                    try:
                        with run_environment(gate_run.subprocess_environment(os.environ.copy())):
                            provisioner.cleanup()
                        cleanup_status = "passed"
                    except Exception as error:
                        cleanup_status = "failed"
                        cleanup_error = str(error)
                        output_text += f"\nProvisioning cleanup failed: {error}\n"

            output_text = redact_runtime_text(output_text, runtime_secrets)
            log_ref = gate_run.write_bytes(
                f"logs/{gate_id}.log",
                output_text.encode("utf-8"),
                media_type="text/plain",
                role="log",
            )
            redacted_artifacts, leaked_artifacts = redact_runtime_artifacts(
                gate_run.run_dir,
                runtime_secrets,
            )
            duration = round(time.time() - started, 3)
            if result is None:
                status = (
                    "passed"
                    if exit_code == 0 and cleanup_status != "failed"
                    else "failed"
                )
                if leaked_artifacts:
                    status = "failed"
                result = {
                    "id": gate_id,
                    "command": command,
                    "environment": environment,
                    "tier": tier,
                    "status": status,
                    "exit_code": exit_code,
                    "duration_seconds": duration,
                    "log": log_ref.to_dict(),
                    "timedOut": timed_out,
                    "cleanupStatus": cleanup_status,
                    "secretScan": {
                        "status": "failed" if leaked_artifacts else "passed",
                        "scannedHighEntropyValues": len(
                            tuple(
                                value
                                for value in runtime_secrets
                                if len(value) >= 16
                            )
                        ),
                        "redactedArtifacts": leaked_artifacts,
                    },
                }
                if manifest:
                    result["manifest"] = manifest
                if redacted_artifacts:
                    result["redactedArtifacts"] = redacted_artifacts
            else:
                result["log"] = log_ref.to_dict()
                result["cleanupStatus"] = cleanup_status
            if cleanup_error:
                result["cleanupError"] = cleanup_error
                result["status"] = "failed"

            result = enrich_result_with_run_artifacts(result, gate_run)
            result = standardize_result(
                result,
                plan_source,
                candidate_mode=candidate_mode,
            )
            if candidate_mode:
                contract = load_agent_v2_contract()
                source = source_identity(REPO_ROOT)
                emit_agent_v2_candidate_metadata(
                    gate_run,
                    gate_id,
                    source,
                )
                artifacts = gate_run.collect_existing_artifacts()
                missing_roles = sorted(
                    set(contract["gates"][gate_id]["roles"]) - set(artifacts)
                )
                if missing_roles:
                    result["status"] = "failed"
                    result["completionStatus"] = "PARTIAL"
                    result["proofStatus"] = "UNPROVEN"
                    result["reason"] = (
                        "candidate is missing mandatory artifact roles: "
                        + ", ".join(missing_roles)
                    )
            gate_run.finalize(result=result, runtime=manifest or {})
            gate_run.publish_latest()
            result["runManifest"] = gate_run.manifest_ref.to_dict()
            if candidate_mode and result.get("status") == "passed":
                candidate_manifest_ref = gate_run.manifest_ref
            gate_run.close()
            active_gate_run = None
            results.append(result)
            print(
                f"[{str(result.get('status')).upper()}] {gate_id} "
                f"duration={duration}s run={gate_run.run_id}"
            )

        report = build_run_report(
            plan_source,
            results,
            candidate_mode=candidate_mode,
        )
        run_ref = aggregate_run.write_json(
            "reports/run.json",
            report,
            role="run",
        )
        aggregate_run.write_bytes(
            "reports/run.md",
            render_markdown(report).encode("utf-8"),
            media_type="text/markdown",
            role="run-markdown",
        )
        aggregate_run.finalize(
            result={
                "status": (
                    "passed"
                    if acceptance_exit_code(
                        report,
                        candidate_mode=candidate_mode,
                    )
                    == 0
                    else "failed"
                ),
                "completionStatus": report.get("completionStatus"),
                "proofStatus": report.get("proofStatus"),
            },
            runtime={"plan": plan_source},
        )
        aggregate_run.publish_latest()
        print(f"run: {json.dumps(run_ref.to_dict(), sort_keys=True)}")
        exit_code = acceptance_exit_code(
            report,
            candidate_mode=candidate_mode,
        )
        if candidate_mode:
            if exit_code != 0 or candidate_manifest_ref is None:
                return exit_code or 1
            write_explicit_json(
                args.candidate_ref_out,
                candidate_manifest_ref.to_dict(),
            )
            sha_path = validate_external_output_path(
                args.candidate_manifest_sha_out,
                repo_root=REPO_ROOT,
            )
            sha_path.parent.mkdir(parents=True, exist_ok=True)
            sha_path.write_text(
                candidate_manifest_ref.sha256 + "\n",
                encoding="utf-8",
            )
        return exit_code
    except EvidenceError as error:
        print(
            f"Acceptance evidence failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1
    finally:
        if active_gate_run is not None:
            active_gate_run.close()
        aggregate_run.close()


if __name__ == "__main__":
    raise SystemExit(main())
