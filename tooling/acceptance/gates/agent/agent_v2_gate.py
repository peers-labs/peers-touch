#!/usr/bin/env python3
"""Fail-closed registration runner for Modern Chat Agent V2 Gates."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import ArtifactSession

MATRIX = {
    "id": "modern-chat-agent-v2-runtime-matrix",
    "version": "2026-08-23.1",
    "sha256": "dba059834fdb4a989be3fa6c0b56fa258a1f2a9ef9d24e6f19f52e3bc2dbf4f0",
}

GATE_ROLES = {
    "agent-v2-kernel-foundation-e2e": (
        "cell-results",
        "receiver-dom",
        "station-readback",
        "runtime-events",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "replay",
        "cleanup",
        "contract-evidence",
        "guard-report",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-home-command-center-e2e": (
        "receiver-dom",
        "station-readback",
        "command-ids",
        "projection-revisions",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "replay",
        "cleanup",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-capability-binding-e2e": (
        "receiver-dom",
        "station-readback",
        "readiness-snapshots",
        "zero-execution",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "replay",
        "cleanup",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-governed-tool-loop-e2e": (
        "receiver-dom",
        "station-readback",
        "executor-receipts",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "cleanup",
        "replay",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-mcp-lifecycle-e2e": (
        "receiver-dom",
        "station-readback",
        "executor-receipts",
        "process-port-secret-canary",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "cleanup",
        "replay",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-connector-invocation-e2e": (
        "receiver-dom",
        "station-readback",
        "oauth-resource-manifest",
        "provider-revoke",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "cleanup",
        "replay",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-evaluation-lab-e2e": (
        "receiver-dom",
        "station-readback",
        "turn-trace",
        "metrics-lineage",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "cleanup",
        "replay",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
}

RUNNER_GENERATED_ROLES = {
    "source-identity",
    "role-schema-report",
    "runner-attestation",
}


def _inside_repo(path: Path) -> bool:
    try:
        path.relative_to(REPO_ROOT)
    except ValueError:
        return False
    return True


def _validate_candidate_with_artifacts(
    gate_id: str,
    manifest_path: Path,
) -> tuple[list[str], dict[str, Path]]:
    issues: list[str] = []
    resolved_manifest = manifest_path.expanduser().resolve()
    if _inside_repo(resolved_manifest):
        return ["candidate manifest must be outside the source tree"], {}
    if not resolved_manifest.is_file():
        return [f"candidate manifest is missing: {resolved_manifest}"], {}

    try:
        candidate = json.loads(resolved_manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"candidate manifest is unreadable: {error}"], {}
    if not isinstance(candidate, dict):
        return ["candidate manifest must be an object"], {}
    if candidate.get("gateId") != gate_id:
        issues.append("candidate gateId does not match requested Gate")
    if candidate.get("runtimeMatrix") != MATRIX:
        issues.append("candidate runtime matrix ID/version/SHA-256 does not match formal W0")
    if candidate.get("scenarioExecuted") is not True:
        issues.append("candidate does not attest a real scenario execution")
    if candidate.get("proofStatus") != "UNPROVEN":
        issues.append("runner candidates must remain UNPROVEN pending separate validation")

    artifacts = candidate.get("artifacts")
    if not isinstance(artifacts, list):
        return issues + ["candidate artifacts must be a list"], {}

    roles: dict[str, Path] = {}
    duplicate_roles: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            issues.append("candidate artifact entry must be an object")
            continue
        role = artifact.get("role")
        raw_path = artifact.get("path")
        if not isinstance(role, str) or not role:
            issues.append("candidate artifact role is missing")
            continue
        if role in roles:
            duplicate_roles.add(role)
            continue
        if not isinstance(raw_path, str) or not raw_path:
            issues.append(f"{role}: artifact path is missing")
            continue
        artifact_path = Path(raw_path).expanduser()
        if not artifact_path.is_absolute():
            artifact_path = resolved_manifest.parent / artifact_path
        artifact_path = artifact_path.resolve()
        roles[role] = artifact_path
        if _inside_repo(artifact_path):
            issues.append(f"{role}: artifact must be outside the source tree")
        elif not artifact_path.is_file():
            issues.append(f"{role}: artifact is missing")
        elif artifact_path.stat().st_size == 0:
            issues.append(f"{role}: artifact is empty")
        else:
            try:
                payload = json.loads(artifact_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                issues.append(f"{role}: artifact is not valid JSON: {error}")
            else:
                if not isinstance(payload, dict):
                    issues.append(f"{role}: artifact must be a JSON object")

    if duplicate_roles:
        issues.append(f"duplicate artifact roles: {sorted(duplicate_roles)}")
    scenario_roles = set(GATE_ROLES[gate_id]) - RUNNER_GENERATED_ROLES
    missing_roles = sorted(scenario_roles - set(roles))
    if missing_roles:
        issues.append(f"missing mandatory artifact roles: {missing_roles}")
    unexpected_roles = sorted(set(roles) - scenario_roles)
    if unexpected_roles:
        issues.append(
            f"scenario manifest contains runner-owned roles: "
            f"{unexpected_roles}"
        )
    return issues, roles


def _validate_candidate(gate_id: str, manifest_path: Path) -> list[str]:
    issues, _ = _validate_candidate_with_artifacts(gate_id, manifest_path)
    return issues


def _report(gate_id: str, manifest: str, issues: list[str]) -> dict[str, Any]:
    candidate_complete = not issues
    return {
        "artifactKind": "agent-v2-gate-registration-verdict",
        "status": "passed" if candidate_complete else "failed",
        "completionStatus": "DONE" if candidate_complete else "PARTIAL",
        "proofStatus": "CANDIDATE" if candidate_complete else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": "W0",
        "bom": ["W0-agent-v2-acceptance-contract-registration"],
        "spec": [
            "docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-execution.md"
        ],
        "gate": gate_id,
        "gateId": gate_id,
        "runtimeMatrix": MATRIX,
        "requiredArtifactRoles": list(GATE_ROLES[gate_id]),
        "candidateManifest": manifest,
        "candidateComplete": candidate_complete,
        "reason": (
            "candidate contains every mandatory role but remains UNPROVEN pending separate validator proof"
            if candidate_complete
            else "real scenario candidate evidence is absent or incomplete"
        ),
        "details": issues,
        "issueBreakdown": [
            {
                "category": "agent-v2-contract-registration",
                "failedStep": "candidate-artifact-contract",
                "status": "failed",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "summary": issue,
                "proofImpact": f"{gate_id} remains UNPROVEN.",
            }
            for issue in issues
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True, choices=sorted(GATE_ROLES))
    parser.add_argument(
        "--candidate-manifest",
        default=os.environ.get("PT_AGENT_V2_CANDIDATE_MANIFEST", ""),
    )
    args = parser.parse_args()

    if args.candidate_manifest:
        issues, role_paths = _validate_candidate_with_artifacts(
            args.gate,
            Path(args.candidate_manifest),
        )
    else:
        issues = [
            "PT_AGENT_V2_CANDIDATE_MANIFEST is required from a real scenario"
        ]
        role_paths = {}
    report = _report(args.gate, args.candidate_manifest, issues)
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=args.gate) as session:
        if not issues:
            for role, path in sorted(role_paths.items()):
                session.write_json(
                    f"roles/{role}.json",
                    json.loads(path.read_text(encoding="utf-8")),
                    role=role,
                    redact=True,
                )
        reference = session.write_json(
            "reports/agent-v2-registration-verdict.json",
            report,
        )
        session.complete(
            status=report["status"],
            completion_status=report["completionStatus"],
            proof_status=report["proofStatus"],
            runtime={"runtimeMatrix": MATRIX},
        )
    print(
        "Agent V2 Gate registration verdict: "
        + json.dumps({"artifactRef": reference.to_dict(), **report}, sort_keys=True)
    )
    return 0 if report["candidateComplete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
