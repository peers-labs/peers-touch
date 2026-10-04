#!/usr/bin/env python3
"""Fail-closed registration runner for Modern Chat Agent V2 Gates."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import ArtifactSession
from tooling.acceptance.core.redaction import redact_text

MATRIX = {
    "id": "modern-chat-agent-v2-runtime-matrix",
    "version": "2026-10-04.1",
    "sha256": "ea40770b7dd7b92869f8156040cdc83c16178f1d0d42887bd141d7cc30376a58",
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
        "contract-evidence",
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
        "contract-evidence",
        "guard-report",
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
        "contract-evidence",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "zero-execution",
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
        "contract-evidence",
        "zero-execution",
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
        "contract-evidence",
        "runtime-attestation-set",
        "measurement-report",
        "side-effect-count",
        "zero-execution",
        "cleanup",
        "replay",
        "source-identity",
        "role-schema-report",
        "runner-attestation",
    ),
    "agent-v2-evaluation-lab-e2e": (
        "cell-results",
        "receiver-dom",
        "station-readback",
        "runtime-events",
        "turn-trace",
        "metrics-lineage",
        "contract-evidence",
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

AUTO_CANDIDATE_PRODUCERS = {
    "agent-v2-capability-binding-e2e": (
        "tooling/acceptance/gates/agent/capability_binding_development.py",
        "--formal-candidate",
    ),
    "agent-v2-governed-tool-loop-e2e": (
        "tooling/acceptance/gates/agent/governed_tool_development.py",
        "--formal-candidate",
    ),
    "agent-v2-mcp-lifecycle-e2e": (
        "tooling/acceptance/gates/agent/mcp_lifecycle_development.py",
        "--formal-candidate",
    ),
}

_CHILD_RUN_CONTEXT_KEYS = (
    "PT_ACCEPTANCE_ARTIFACT_ROOT",
    "PT_ACCEPTANCE_WORKSPACE_ID",
    "PT_ACCEPTANCE_GATE_ID",
    "PT_ACCEPTANCE_REDACTION_VALUES",
    "PT_AGENT_V2_CANDIDATE_MANIFEST",
)
_AUTO_PRODUCER_TIMEOUT_SECONDS = 3_600


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


def _load_role_payloads(role_paths: dict[str, Path]) -> dict[str, dict[str, Any]]:
    return {
        role: json.loads(path.read_text(encoding="utf-8"))
        for role, path in role_paths.items()
    }


def _candidate_path_from_output(output: str, artifact_root: Path) -> Path:
    for line in reversed(output.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        raw_path = payload.get("candidate") if isinstance(payload, dict) else None
        if not isinstance(raw_path, str) or not raw_path:
            continue
        candidate_path = Path(raw_path).expanduser().resolve()
        try:
            candidate_path.relative_to(artifact_root)
        except ValueError as error:
            raise ValueError(
                "candidate producer returned a path outside its artifact root"
            ) from error
        return candidate_path
    raise ValueError("candidate producer did not emit a candidate path")


def _produce_candidate(
    gate_id: str,
) -> tuple[str, list[str], dict[str, dict[str, Any]]]:
    producer = AUTO_CANDIDATE_PRODUCERS.get(gate_id)
    if producer is None:
        return (
            "",
            ["PT_AGENT_V2_CANDIDATE_MANIFEST is required from a real scenario"],
            {},
        )

    producer_label = "auto:" + " ".join(producer)
    with tempfile.TemporaryDirectory(
        prefix=f"peers-touch-{gate_id}-candidate-"
    ) as directory:
        artifact_root = Path(directory).resolve()
        environment = os.environ.copy()
        for key in _CHILD_RUN_CONTEXT_KEYS:
            environment.pop(key, None)
        environment["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifact_root)
        try:
            completed = subprocess.run(
                [sys.executable, *producer],
                cwd=REPO_ROOT,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
                timeout=_AUTO_PRODUCER_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return (
                producer_label,
                [
                    "candidate producer timed out after "
                    f"{_AUTO_PRODUCER_TIMEOUT_SECONDS} seconds"
                ],
                {},
            )
        except OSError as error:
            return (
                producer_label,
                [f"candidate producer could not start: {error}"],
                {},
            )
        if completed.returncode != 0:
            diagnostic = redact_text(
                (completed.stderr.strip() or completed.stdout.strip())[-4_000:]
            )
            return (
                producer_label,
                [
                    "candidate producer failed with exit code "
                    f"{completed.returncode}"
                    + (f": {diagnostic}" if diagnostic else "")
                ],
                {},
            )
        try:
            candidate_path = _candidate_path_from_output(
                completed.stdout,
                artifact_root,
            )
        except ValueError as error:
            return producer_label, [str(error)], {}

        issues, role_paths = _validate_candidate_with_artifacts(
            gate_id,
            candidate_path,
        )
        if issues:
            return producer_label, issues, {}
        return producer_label, [], _load_role_payloads(role_paths)


def _resolve_candidate(
    gate_id: str,
    manifest: str,
) -> tuple[str, list[str], dict[str, dict[str, Any]]]:
    if not manifest:
        return _produce_candidate(gate_id)
    issues, role_paths = _validate_candidate_with_artifacts(
        gate_id,
        Path(manifest),
    )
    return (
        manifest,
        issues,
        {} if issues else _load_role_payloads(role_paths),
    )


def _report(gate_id: str, manifest: str, issues: list[str]) -> dict[str, Any]:
    candidate_complete = not issues
    return {
        "artifactKind": "acceptance-gate-evidence-report",
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

    manifest, issues, role_payloads = _resolve_candidate(
        args.gate,
        args.candidate_manifest,
    )
    report = _report(args.gate, manifest, issues)
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=args.gate) as session:
        if not issues:
            for role, payload in sorted(role_payloads.items()):
                session.write_json(
                    f"roles/{role}.json",
                    payload,
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
