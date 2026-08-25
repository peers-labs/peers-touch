#!/usr/bin/env python3
"""Fail-closed read-only detector for Acceptance evidence gaps.

Validates two layers:
  1. Plan↔run consistency: changed paths match plan, required gates ran
     and produced DONE/PROVEN evidence.
  2. Closure contract deliverables: when a --contract YAML is supplied,
     every declared deliverable must have corresponding mechanical
     evidence (scan reports or gate results). This eliminates AI
     discretion over what counts as 'done'.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
RECEIVER_PROOF_GATE = "chat-native-two-client-e2e"
RECEIVER_VISIBLE_PATHS = {
    "apps/desktop/src-tauri/src/messaging/direct.rs",
    "apps/desktop/src/runtimes/imRuntime.ts",
    "apps/desktop/src/services/chatReceipt.ts",
    "apps/desktop/src/store/socialChat.ts",
    "apps/desktop/src/store/socialProjection.ts",
    "apps/station/app/subserver/messaging/application/receipt_service.go",
    "apps/station/app/subserver/messaging/interface/http/receipt_handler.go",
}

SCAN_TYPE_TO_GATE = {
    "path-absent": "chat-w11-forbidden-scan",
    "source-scan": "chat-w11-forbidden-scan",
    "http-route-absent": "chat-w11-forbidden-scan",
    "tauri-command-absent": "chat-w11-forbidden-scan",
    "no-duplicate-symbol": "chat-w11-duplicate-scan",
}


class DetectorError(RuntimeError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DetectorError(f"cannot load {path}: {error}") from error
    if not isinstance(value, dict):
        raise DetectorError(f"{path} must contain a JSON object")
    return value


def changed_paths(diff_range: str) -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", diff_range],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise DetectorError(
            f"cannot inspect git range {diff_range!r}: {completed.stderr.strip()}"
        )
    paths = {
        line.strip()
        for line in completed.stdout.splitlines()
        if line.strip()
    }
    if diff_range == "HEAD":
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        paths.update(
            line.strip()
            for line in untracked.stdout.splitlines()
            if line.strip()
        )
    return sorted(paths)


def current_source_identity() -> tuple[str, str]:
    from tooling.acceptance.core.attestation import source_workspace_digest

    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return commit, source_workspace_digest(REPO_ROOT)


def gate_entries(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for entry in plan.get("selected_gates", []):
        if isinstance(entry, str):
            entries[entry] = {"id": entry}
        elif isinstance(entry, dict) and entry.get("id"):
            entries[str(entry["id"])] = entry
    return entries


def result_entries(run: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(result["id"]): result
        for result in run.get("results", [])
        if isinstance(result, dict) and result.get("id")
    }


def gap(
    *,
    gap_type: str,
    claim: str,
    owner_stage: str,
    required_closure: str,
    evidence: list[dict[str, Any]],
    status: str = "BLOCKING",
) -> dict[str, Any]:
    from tooling.acceptance.core import GapArtifact

    return GapArtifact(
        claim=claim,
        gap_type=gap_type,
        owner_stage=owner_stage,
        required_closure=required_closure,
        evidence=tuple(evidence),
        status=status,
    ).to_dict()


def _load_contract(path: Path) -> dict[str, Any]:
    try:
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ImportError:
        pass
    sys.path.insert(0, str(REPO_ROOT / "tooling" / "scripts"))
    from importlib import import_module
    gen = import_module("acceptance-closure-gen".replace("-", "_"))
    return gen.load_yaml(path)


def validate_contract_deliverables(
    contract: dict[str, Any],
    results: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    deliverables = contract.get("deliverables", [])
    if not isinstance(deliverables, list):
        return gaps

    for d in deliverables:
        if not isinstance(d, dict):
            continue
        did = str(d.get("id", "?"))
        verify = d.get("verify", {})
        if not isinstance(verify, dict):
            continue
        vtype = verify.get("type", "")

        if vtype in SCAN_TYPE_TO_GATE:
            gate_id = SCAN_TYPE_TO_GATE[vtype]
            result = results.get(gate_id)
            if result is None:
                gaps.append(
                    gap(
                        gap_type="CONTRACT_SCAN_GATE_NOT_RUN",
                        claim=f"contract deliverable {did}",
                        owner_stage="EXECUTE",
                        required_closure=f"Run {gate_id} to verify {did}",
                        evidence=[{
                            "deliverableId": did,
                            "verifyType": vtype,
                            "requiredGate": gate_id,
                        }],
                    )
                )
            elif str(result.get("status") or "") != "passed":
                gaps.append(
                    gap(
                        gap_type="CONTRACT_SCAN_GATE_FAILED",
                        claim=f"contract deliverable {did}",
                        owner_stage="EXECUTE",
                        required_closure=f"Fix violations found by {gate_id}",
                        evidence=[{
                            "deliverableId": did,
                            "verifyType": vtype,
                            "gateId": gate_id,
                            "gateStatus": result.get("status"),
                        }],
                    )
                )

        elif vtype == "gates-passed":
            for gid in verify.get("gates", []):
                result = results.get(gid)
                if result is None:
                    gaps.append(
                        gap(
                            gap_type="CONTRACT_GATE_NOT_RUN",
                            claim=f"contract deliverable {did}",
                            owner_stage="EXECUTE",
                            required_closure=f"Run gate {gid}",
                            evidence=[{"deliverableId": did, "gateId": gid}],
                        )
                    )
                elif str(result.get("status") or "") != "passed":
                    gaps.append(
                        gap(
                            gap_type="CONTRACT_GATE_FAILED",
                            claim=f"contract deliverable {did}",
                            owner_stage="EXECUTE",
                            required_closure=f"Gate {gid} must pass",
                            evidence=[{
                                "deliverableId": did,
                                "gateId": gid,
                                "gateStatus": result.get("status"),
                            }],
                        )
                    )

        elif vtype == "gate-passed":
            gid = verify.get("gate", "")
            if not gid:
                continue
            result = results.get(gid)
            if result is None:
                gaps.append(
                    gap(
                        gap_type="CONTRACT_GATE_NOT_RUN",
                        claim=f"contract deliverable {did}",
                        owner_stage="EXECUTE",
                        required_closure=f"Run gate {gid}",
                        evidence=[{"deliverableId": did, "gateId": gid}],
                    )
                )
            elif str(result.get("status") or "") != "passed":
                gaps.append(
                    gap(
                        gap_type="CONTRACT_GATE_FAILED",
                        claim=f"contract deliverable {did}",
                        owner_stage="EXECUTE",
                        required_closure=f"Gate {gid} must pass",
                        evidence=[{
                            "deliverableId": did,
                            "gateId": gid,
                            "gateStatus": result.get("status"),
                        }],
                    )
                )

    return gaps


def detect(
    *,
    claim: str,
    paths: list[str],
    plan: dict[str, Any],
    run: dict[str, Any],
    required_gates: list[str],
    source_commit: str = "",
    workspace_digest: str = "",
    contract: dict[str, Any] | None = None,
) -> dict[str, Any]:
    gaps: list[dict[str, Any]] = []
    selected = gate_entries(plan)
    results = result_entries(run)
    obligations = set(required_gates)

    if contract:
        gaps.extend(validate_contract_deliverables(contract, results))

    planned_paths = plan.get("changed_paths")
    if isinstance(planned_paths, list):
        normalized_planned_paths = {
            str(path) for path in planned_paths if str(path)
        }
        actual_paths = set(paths)
        if normalized_planned_paths != actual_paths:
            gaps.append(
                gap(
                    gap_type="ACCEPTANCE_GAP_DETECTOR_INPUT_INVALID",
                    claim=claim,
                    owner_stage="PLAN",
                    required_closure=(
                        "Regenerate the Acceptance plan for the detector's "
                        "exact git range"
                    ),
                    evidence=[
                        {
                            "reason": "Acceptance plan paths do not match detector range",
                            "missingFromPlan": sorted(
                                actual_paths - normalized_planned_paths
                            ),
                            "notInRange": sorted(
                                normalized_planned_paths - actual_paths
                            ),
                        }
                    ],
                )
            )

    receipt_paths = sorted(RECEIVER_VISIBLE_PATHS.intersection(paths))
    if receipt_paths:
        obligations.add(RECEIVER_PROOF_GATE)
        if RECEIVER_PROOF_GATE not in selected:
            gaps.append(
                gap(
                    gap_type="RECEIVER_PROOF_GATE_NOT_SELECTED",
                    claim=claim,
                    owner_stage="EXECUTE",
                    required_closure=(
                        f"Select and execute {RECEIVER_PROOF_GATE} for "
                        "receiver-visible receipt changes"
                    ),
                    evidence=[
                        {"path": path, "reason": "receiver-visible owner changed"}
                        for path in receipt_paths
                    ],
                )
            )

    obligations.update(selected)
    for gate_id in sorted(obligations):
        result = results.get(gate_id)
        gate = selected.get(gate_id, {})
        if result is None:
            gaps.append(
                gap(
                    gap_type="REQUIRED_GATE_NOT_RUN",
                    claim=claim,
                    owner_stage="EXECUTE",
                    required_closure=f"Run required Gate {gate_id}",
                    evidence=[
                        {
                            "gateId": gate_id,
                            "environment": gate.get("environment", "unknown"),
                            "tier": gate.get("tier", "unknown"),
                        }
                    ],
                )
            )
            continue

        status = str(result.get("status") or "")
        completion = str(result.get("completionStatus") or "")
        proof = str(result.get("proofStatus") or "")
        tier = str(gate.get("tier") or "")
        if status == "blocked":
            gaps.append(
                gap(
                    gap_type="GATE_BLOCKED_BY_ENVIRONMENT",
                    claim=claim,
                    owner_stage="EXECUTE",
                    required_closure=str(
                        result.get("blockedReason")
                        or f"Resolve the provisioning blocker for {gate_id}"
                    ),
                    evidence=[
                        {
                            "gateId": gate_id,
                            "blockedResource": result.get("blockedResource"),
                            "sourceArtifact": result.get("sourceArtifact"),
                        }
                    ],
                )
            )
            continue
        if status == "passed" and tier in {"ci-structure", "ci-cheap"}:
            continue
        if (
            status != "passed"
            or completion != "DONE"
            or proof != "PROVEN"
        ):
            gaps.append(
                gap(
                    gap_type="GATE_EVIDENCE_UNPROVEN",
                    claim=claim,
                    owner_stage="EXECUTE",
                    required_closure=(
                        f"Produce DONE/PROVEN evidence for Gate {gate_id}"
                    ),
                    evidence=[
                        {
                            "gateId": gate_id,
                            "status": status,
                            "completionStatus": completion,
                            "proofStatus": proof,
                            "sourceArtifact": result.get("sourceArtifact"),
                        }
                    ],
                )
            )
            continue

        if gate.get("provisioner"):
            manifest = result.get("manifest")
            if (
                not isinstance(manifest, dict)
                or manifest.get("state") != "FIXTURE_READY"
                or not manifest.get("runId")
            ):
                gaps.append(
                    gap(
                        gap_type="RUNTIME_MANIFEST_MISSING",
                        claim=claim,
                        owner_stage="EXECUTE",
                        required_closure=(
                            f"Attach the FIXTURE_READY Runtime Manifest for {gate_id}"
                        ),
                        evidence=[{"gateId": gate_id}],
                    )
                )
                continue
            source = manifest.get("source")
            if not isinstance(source, dict):
                source = {}
            if source_commit and source.get("commit") != source_commit:
                gaps.append(
                    gap(
                        gap_type="ACCEPTANCE_EVIDENCE_STALE",
                        claim=claim,
                        owner_stage="EXECUTE",
                        required_closure=f"Re-run Gate {gate_id} at the current commit",
                        evidence=[
                            {
                                "gateId": gate_id,
                                "evidenceCommit": source.get("commit"),
                                "currentCommit": source_commit,
                            }
                        ],
                    )
                )
            if (
                workspace_digest
                and source.get("workspaceDigest") != workspace_digest
            ):
                gaps.append(
                    gap(
                        gap_type="ACCEPTANCE_EVIDENCE_STALE",
                        claim=claim,
                        owner_stage="EXECUTE",
                        required_closure=(
                            f"Re-run Gate {gate_id} for the current workspace"
                        ),
                        evidence=[
                            {
                                "gateId": gate_id,
                                "evidenceWorkspaceDigest": source.get(
                                    "workspaceDigest"
                                ),
                                "currentWorkspaceDigest": workspace_digest,
                            }
                        ],
                    )
                )

    proof_state = "PROVEN" if not gaps else "UNPROVEN"
    return {
        "artifactKind": "acceptance-gap-report",
        "claim": claim,
        "proofState": proof_state,
        "changedPaths": paths,
        "selectedGates": sorted(selected),
        "requiredGates": sorted(obligations),
        "gaps": gaps,
    }


def main() -> int:
    from tooling.acceptance.core import (
        RUN_GATE_ENV,
        ArtifactSession,
        EvidenceStore,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--claim", default="Current change is acceptance-ready")
    parser.add_argument("--range", dest="diff_range", default="HEAD")
    parser.add_argument("--plan")
    parser.add_argument("--run")
    parser.add_argument("--require-gate", action="append", default=[])
    parser.add_argument(
        "--contract",
        help="Path to closure contract YAML for deliverable validation",
    )
    args = parser.parse_args()

    try:
        store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        plan = (
            load_json(Path(args.plan))
            if args.plan
            else store.read_json(
                store.latest_artifact_ref("acceptance-plan", "plan")
            )
        )
        run = (
            load_json(Path(args.run))
            if args.run
            else store.read_json(
                store.latest_artifact_ref("acceptance-run", "run")
            )
        )
        contract = None
        if args.contract:
            contract_path = Path(args.contract)
            if not contract_path.is_absolute():
                contract_path = REPO_ROOT / contract_path
            if contract_path.exists():
                contract = _load_contract(contract_path)
        source_commit, workspace_digest = current_source_identity()
        report = detect(
            claim=args.claim,
            paths=changed_paths(args.diff_range),
            plan=plan,
            run=run,
            required_gates=args.require_gate,
            source_commit=source_commit,
            workspace_digest=workspace_digest,
            contract=contract,
        )
    except DetectorError as error:
        sys.stderr.write(f"acceptance gap detector failed closed: {error}\n")
        return 2

    serialized = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    gate_id = os.environ.get(RUN_GATE_ENV) or "acceptance-gap-detect"
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as session:
        session.write_bytes(
            "reports/gap-report.json",
            serialized.encode("utf-8"),
            media_type="application/json",
            role="gap-report",
        )
        proven = report["proofState"] == "PROVEN"
        session.complete(
            status="passed" if proven else "failed",
            completion_status="DONE" if proven else "PARTIAL",
            proof_status=report["proofState"],
        )
    sys.stdout.write(serialized)
    return 0 if report["proofState"] == "PROVEN" else 1


if __name__ == "__main__":
    raise SystemExit(main())
