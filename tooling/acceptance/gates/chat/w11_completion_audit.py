#!/usr/bin/env python3
"""W11 closure gate: mechanical completion audit driven by closure contract.

Verifies that every deliverable in the closure contract has corresponding
passing evidence:
  - Scan deliverables (path-absent, source-scan, http-route-absent,
    tauri-command-absent, no-duplicate-symbol) are verified by the
    forbidden-scan and duplicate-scan gates passing.
  - Gate deliverables (gates-passed, gate-passed) have passing report
    files with PASS status and zero failed assertions.

This gate is deterministic — it does not perform AI-style judgment.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from tooling.acceptance.core.evidence_store import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    source_identity,
    workspace_id,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
MANIFEST_PATH = Path(
    os.environ.get(
        "PT_W11_CONTRACT_MANIFEST",
        str(REPO_ROOT / "tooling" / "acceptance" / "reports" / "w11-contract-manifest.json"),
    )
)
CONTRACT_PATH = Path(
    os.environ.get(
        "PT_W11_CONTRACT",
        str(REPO_ROOT / "tooling" / "acceptance" / "closures" / "messaging-w11.yaml"),
    )
)

SCAN_GATE_MAP = {
    "path-absent": "chat-w11-forbidden-scan",
    "source-scan": "chat-w11-forbidden-scan",
    "http-route-absent": "chat-w11-forbidden-scan",
    "tauri-command-absent": "chat-w11-forbidden-scan",
    "no-duplicate-symbol": "chat-w11-duplicate-scan",
}


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        print(
            f"FAIL: contract manifest not found at {MANIFEST_PATH}. "
            "Run acceptance-closure-gen.py first.",
            file=sys.stderr,
        )
        sys.exit(2)
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def load_latest_gate_evidence(
    store: EvidenceStore,
    gate_id: str,
    *,
    expected_source: dict[str, str],
    runtime_cell: str | None = None,
    require_report: bool = False,
) -> dict:
    manifest = store.latest(gate_id, runtime_cell=runtime_cell)
    if (
        manifest.get("artifactKind") != "acceptance-run-manifest"
        or manifest.get("workspaceId") != store.workspace_id
        or manifest.get("gateId") != gate_id
        or not manifest.get("runId")
        or manifest.get("source") != expected_source
        or manifest.get("redaction", {}).get("status") != "passed"
    ):
        raise AssertionError(
            f"{gate_id}: latest manifest identity does not match the current source"
        )
    result = manifest.get("result")
    if not isinstance(result, dict) or result.get("status") != "passed":
        status = result.get("status") if isinstance(result, dict) else None
        raise AssertionError(f"{gate_id}: latest Gate status is {status!r}, expected 'passed'")
    if result.get("completionStatus") != "DONE":
        raise AssertionError(
            f"{gate_id}: latest Gate completionStatus is "
            f"{result.get('completionStatus')!r}, expected 'DONE'"
        )
    if result.get("proofStatus") != "PROVEN":
        raise AssertionError(
            f"{gate_id}: latest Gate proofStatus is "
            f"{result.get('proofStatus')!r}, expected 'PROVEN'"
        )

    if runtime_cell is not None and result.get("runtimeCell") != runtime_cell:
        raise AssertionError(
            f"{gate_id}: latest Gate runtime cell is "
            f"{result.get('runtimeCell')!r}, expected {runtime_cell!r}"
        )
    secret_scan = result.get("secretScan")
    if not isinstance(secret_scan, dict) or secret_scan.get("status") != "passed":
        raise AssertionError(f"{gate_id}: latest Gate secret scan did not pass")

    accepted = {
        "gateId": gate_id,
        "runId": manifest["runId"],
        "runtimeCell": runtime_cell,
    }
    if not require_report:
        return accepted

    source_artifact = result.get("sourceArtifact")
    if (
        result.get("sourceArtifactKind") != "acceptance-gate-evidence-report"
        or not isinstance(source_artifact, dict)
    ):
        raise AssertionError(
            f"{gate_id}: latest Gate has no canonical evidence report"
        )
    reference = ArtifactRef.from_dict(source_artifact)
    if (
        reference.workspace_id != store.workspace_id
        or reference.gate_id != gate_id
        or reference.run_id != manifest["runId"]
        or reference.to_dict()
        not in tuple(manifest.get("artifacts", {}).values())
    ):
        raise AssertionError(
            f"{gate_id}: canonical evidence report identity is inconsistent"
        )
    report = store.read_json(reference)
    runtime_manifest_payload = result.get("runtimeCellManifest")
    if not isinstance(runtime_manifest_payload, dict):
        raise AssertionError(
            f"{gate_id}: latest Gate has no runtime-cell manifest payload"
        )
    runtime_manifest_ref_value = runtime_manifest_payload.get("_manifest_ref")
    if not isinstance(runtime_manifest_ref_value, dict):
        raise AssertionError(
            f"{gate_id}: runtime-cell manifest has no immutable artifact reference"
        )
    runtime_manifest_ref = ArtifactRef.from_dict(runtime_manifest_ref_value)
    if (
        runtime_manifest_ref.workspace_id != store.workspace_id
        or runtime_manifest_ref.gate_id != gate_id
        or runtime_manifest_ref.run_id != manifest["runId"]
        or runtime_manifest_ref.to_dict()
        not in tuple(manifest.get("artifacts", {}).values())
    ):
        raise AssertionError(
            f"{gate_id}: runtime-cell manifest artifact identity is inconsistent"
        )
    immutable_runtime_manifest = store.read_json(runtime_manifest_ref)
    errors = check_report_status(report, gate_id)
    errors.extend(
        compare_runtime_manifest_identity(
            runtime_manifest_payload,
            immutable_runtime_manifest,
            label=f"{gate_id}: runner runtime-cell manifest",
        )
    )
    errors.extend(
        check_native_report_identity(
            report,
            gate_id,
            expected_source=expected_source,
            runtime_cell=runtime_cell or "",
            expected_runtime_manifest=immutable_runtime_manifest,
        )
    )
    if errors:
        raise AssertionError("; ".join(errors))
    accepted["sourceArtifact"] = reference.to_dict()
    return accepted


def check_report_status(report: dict, label: str) -> list[str]:
    errors: list[str] = []
    status = str(report.get("status") or "").lower()
    if status not in {"pass", "passed"}:
        errors.append(f"{label}: status is {status!r}, expected 'PASS'")
    if report.get("artifactKind") != "acceptance-gate-evidence-report":
        errors.append(f"{label}: invalid evidence report kind")
    if report.get("gateId") != label:
        errors.append(f"{label}: evidence report Gate identity mismatch")
    if report.get("completionStatus") != "DONE":
        errors.append(f"{label}: evidence report is not DONE")
    if report.get("proofStatus") != "PROVEN":
        errors.append(f"{label}: evidence report is not PROVEN")
    if report.get("sampleEmissionAllowed") is not True:
        errors.append(f"{label}: evidence report cannot emit a proof sample")
    if report.get("error"):
        errors.append(f"{label}: report contains error: {report['error']}")
    assertions = report.get("assertions", [])
    if not isinstance(assertions, list) or not assertions:
        errors.append(f"{label}: no assertions recorded")
    elif any(
        not isinstance(assertion, dict)
        or assertion.get("passed") is not True
        for assertion in assertions
    ):
        failed = [
            assertion.get("name", "?")
            if isinstance(assertion, dict)
            else "malformed"
            for assertion in assertions
            if not isinstance(assertion, dict)
            or assertion.get("passed") is not True
        ]
        if failed:
            errors.append(f"{label}: failed or malformed assertions: {failed}")
    return errors


def _nested_value(value: dict, path: tuple[str, ...]) -> object:
    current: object = value
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def source_identities_match(
    observed: object,
    expected: dict[str, str],
) -> bool:
    if not isinstance(observed, dict):
        return False
    if (
        observed.get("commit") != expected.get("commit")
        or observed.get("workspaceDigest") != expected.get("workspaceDigest")
    ):
        return False

    expected_worktree_hash = expected.get("canonicalWorktreeHash")
    observed_worktree_hash = observed.get("canonicalWorktreeHash")
    observed_worktree = observed.get("worktree")
    if not expected_worktree_hash or not (
        observed_worktree_hash or observed_worktree
    ):
        return False
    if (
        observed_worktree_hash
        and observed_worktree_hash != expected_worktree_hash
    ):
        return False
    if (
        observed_worktree
        and workspace_id(Path(str(observed_worktree)))
        != expected_worktree_hash
    ):
        return False
    return True


def compare_runtime_manifest_identity(
    observed: dict,
    immutable: dict,
    *,
    label: str,
) -> list[str]:
    identity_fields = (
        ("artifactKind",),
        ("cellId",),
        ("gateId",),
        ("runId",),
        ("state",),
        ("source", "mode"),
        ("source", "commit"),
        ("source", "workspaceDigest"),
        ("source", "remoteSourceDigest"),
        ("source", "remoteCheckoutClean"),
        ("source", "binarySha256"),
        ("platform", "os"),
        ("platform", "architecture"),
        ("platform", "isolationKind"),
        ("platform", "imageDigest"),
        ("transport", "kind"),
        ("transport", "hostIdentitySha256"),
        ("transport", "hostKeySha256"),
    )
    missing = [
        ".".join(path)
        for path in identity_fields
        if _nested_value(immutable, path) is None
    ]
    mismatched = [
        ".".join(path)
        for path in identity_fields
        if _nested_value(observed, path) != _nested_value(immutable, path)
    ]
    errors: list[str] = []
    if missing:
        errors.append(f"{label} immutable identity is incomplete: {missing}")
    if mismatched:
        errors.append(f"{label} identity mismatch: {mismatched}")
    return errors


def check_native_report_identity(
    report: dict,
    label: str,
    *,
    expected_source: dict[str, str],
    runtime_cell: str,
    expected_runtime_manifest: object,
) -> list[str]:
    errors: list[str] = []
    runtime = report.get("runtime")
    if not isinstance(runtime, dict):
        return [f"{label}: runtime evidence is missing"]
    if runtime.get("runtimeCell") != runtime_cell:
        errors.append(f"{label}: report runtime cell identity mismatch")

    identity = runtime.get("sourceIdentity")
    if not isinstance(identity, dict):
        return errors + [f"{label}: report source identity is missing"]
    orchestrator = identity.get("orchestrator")
    cell = identity.get("runtimeCell")
    binary = identity.get("binary")
    if not source_identities_match(orchestrator, expected_source):
        errors.append(f"{label}: report orchestrator source identity mismatch")
    if (
        not isinstance(cell, dict)
        or cell.get("artifactKind")
        != "acceptance-runtime-cell-manifest"
        or cell.get("cellId") != runtime_cell
        or cell.get("gateId") != label
        or not cell.get("runId")
        or cell.get("runId") != runtime.get("runtimeCellRunId")
        or cell.get("state") != "LEASED"
    ):
        errors.append(f"{label}: report runtime-cell manifest identity mismatch")
        return errors
    if not isinstance(expected_runtime_manifest, dict):
        errors.append(
            f"{label}: immutable runtime-cell manifest is missing"
        )
    else:
        errors.extend(
            compare_runtime_manifest_identity(
                cell,
                expected_runtime_manifest,
                label=f"{label}: report runtime-cell",
            )
        )

    cell_source = cell.get("source")
    binary_digest = (
        str(binary.get("sha256") or "")
        if isinstance(binary, dict)
        else ""
    )
    if (
        not isinstance(binary, dict)
        or binary.get("sourceCommit") != expected_source.get("commit")
        or re.fullmatch(r"[0-9a-f]{64}", binary_digest) is None
        or not isinstance(cell_source, dict)
        or cell_source.get("commit") != expected_source.get("commit")
        or cell_source.get("workspaceDigest") != "clean"
        or cell_source.get("binarySha256") != binary_digest
    ):
        errors.append(f"{label}: report source or binary identity mismatch")
    if runtime_cell == "desktop-linux-native":
        platform = cell.get("platform")
        transport = cell.get("transport")
        if (
            not isinstance(cell_source, dict)
            or cell_source.get("remoteCheckoutClean") is not True
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(cell_source.get("remoteSourceDigest") or ""),
            )
            is None
            or not isinstance(platform, dict)
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(platform.get("imageDigest") or ""),
            )
            is None
            or not isinstance(transport, dict)
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(transport.get("hostIdentitySha256") or ""),
            )
            is None
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(transport.get("hostKeySha256") or ""),
            )
            is None
        ):
            errors.append(f"{label}: Linux runtime attestation is incomplete")
    return errors


def main() -> int:
    manifest = load_manifest()
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    current_source = source_identity(REPO_ROOT)
    claimed_runtime_cell = manifest.get("claimed_runtime_cell")
    if not isinstance(claimed_runtime_cell, str) or not claimed_runtime_cell:
        print("FAIL: W11 contract manifest has no claimed runtime cell")
        return 1
    targets = manifest.get("scan_targets", {})
    errors: list[str] = []
    accepted_gates: list[dict] = []
    verified_deliverables: list[str] = []

    required_gates: set[str] = set()
    scan_gates_needed: set[str] = set()

    for did, target in targets.items():
        vtype = target.get("type", "")
        if vtype in SCAN_GATE_MAP:
            scan_gates_needed.add(SCAN_GATE_MAP[vtype])
            verified_deliverables.append(did)
        elif vtype == "gates-passed":
            for gid in target.get("gates", []):
                required_gates.add(gid)
        elif vtype == "gate-passed":
            gid = target.get("gate", "")
            if gid:
                required_gates.add(gid)

    for gate_id in sorted(scan_gates_needed):
        try:
            accepted_gates.append(
                load_latest_gate_evidence(
                    store,
                    gate_id,
                    expected_source=current_source,
                )
            )
        except Exception as exc:
            errors.append(f"scan gate {gate_id!r} evidence unavailable: {exc}")

    for gate_id in sorted(required_gates):
        if gate_id == "chat-w11-completion-audit":
            continue
        try:
            native_gate = (
                gate_id.startswith("chat-native-")
                and gate_id.endswith("-e2e")
            )
            accepted_gates.append(
                load_latest_gate_evidence(
                    store,
                    gate_id,
                    expected_source=current_source,
                    runtime_cell=(
                        claimed_runtime_cell if native_gate else None
                    ),
                    require_report=native_gate,
                )
            )
        except Exception as exc:
            errors.append(str(exc))

    passed = not errors
    closure_verdict = {
        "artifactKind": "chat-w11-closure-verdict",
        "status": "PASS" if passed else "FAIL",
        "completionStatus": "DONE" if passed else "PARTIAL",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "contract": str(CONTRACT_PATH.relative_to(REPO_ROOT)),
        "source": current_source,
        "claimedRuntimeCell": claimed_runtime_cell,
        "unprovenRuntimeCells": [
            cell
            for cell in (
                "desktop-macos-native",
                "desktop-windows-native",
            )
            if cell != claimed_runtime_cell
        ],
        "verifiedDeliverables": verified_deliverables,
        "acceptedGates": accepted_gates,
        "errors": errors,
        "remainingClosureStep": "independent review (pt-github-review)",
    }
    with ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id="chat-w11-completion-audit",
        source=current_source,
    ) as session:
        reference = session.write_json(
            "reports/chat-w11-closure-verdict.json",
            closure_verdict,
            role="closure-verdict",
        )
        session.complete(
            status="passed" if passed else "failed",
            completion_status="DONE" if passed else "PARTIAL",
            proof_status="PROVEN" if passed else "UNPROVEN",
            runtime={"claimedRuntimeCell": claimed_runtime_cell},
        )

    if errors:
        print("FAIL: W11 completion audit found gaps:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print(
        f"PASS: W11 completion audit — {len(verified_deliverables)} scan "
        f"deliverables, {len(accepted_gates)} Gate runs verified"
    )
    print(f"  Verdict: {json.dumps(reference.to_dict(), sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
