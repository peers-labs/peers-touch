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
import sys
from pathlib import Path

from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore

REPO_ROOT = Path(__file__).resolve().parents[4]
REPORTS_DIR = REPO_ROOT / "tooling" / "acceptance" / "reports"
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


def load_report(path: Path) -> dict:
    if not path.exists():
        raise AssertionError(f"report missing: {path.relative_to(REPO_ROOT)}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssertionError(f"report unreadable: {path.relative_to(REPO_ROOT)}: {exc}")


def load_latest_gate_report(store: EvidenceStore, gate_id: str) -> dict | None:
    runtime_cell = (
        "desktop-linux-native"
        if gate_id.startswith("chat-native-") and gate_id.endswith("-e2e")
        else None
    )
    manifest = store.latest(gate_id, runtime_cell=runtime_cell)
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

    for evidence in result.get("evidenceArtifacts", []):
        if (
            isinstance(evidence, dict)
            and evidence.get("artifactKind") == "acceptance-gate-evidence-report"
        ):
            reference = ArtifactRef.from_dict(evidence.get("path", {}))
            return store.read_json(reference)
    return None


def check_report_status(report: dict, label: str) -> list[str]:
    errors: list[str] = []
    status = report.get("status")
    if status != "PASS":
        errors.append(f"{label}: status is {status!r}, expected 'PASS'")
    if report.get("error"):
        errors.append(f"{label}: report contains error: {report['error']}")
    assertions = report.get("assertions", [])
    if not assertions:
        errors.append(f"{label}: no assertions recorded")
    else:
        failed = [
            a for a in assertions
            if isinstance(a, dict) and a.get("passed") is False
        ]
        if failed:
            names = [a.get("name", "?") for a in failed]
            errors.append(f"{label}: failed assertions: {names}")
    return errors


def gate_report_filename(gate_id: str) -> str:
    return gate_id.replace("chat-native-", "chat-native-").replace("-e2e", "-run") + ".json"


def main() -> int:
    manifest = load_manifest()
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    targets = manifest.get("scan_targets", {})
    errors: list[str] = []
    passed_reports: list[str] = []
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
            latest = store.latest(gate_id)
            result = latest.get("result")
            if not isinstance(result, dict) or result.get("status") != "passed":
                status = result.get("status") if isinstance(result, dict) else None
                errors.append(f"scan gate {gate_id!r} status is {status!r}")
        except Exception as exc:
            errors.append(f"scan gate {gate_id!r} evidence unavailable: {exc}")

    for gate_id in sorted(required_gates):
        if gate_id == "chat-w11-completion-audit":
            continue
        try:
            report = load_latest_gate_report(store, gate_id)
            passed_reports.append(f"evidence-store:{gate_id}")
            if report is not None:
                errors.extend(check_report_status(report, gate_id))
        except Exception as exc:
            errors.append(str(exc))

    if errors:
        print("FAIL: W11 completion audit found gaps:")
        for err in errors:
            print(f"  - {err}")
        return 1

    closure_verdict = {
        "artifactKind": "chat-w11-closure-verdict",
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "contract": str(CONTRACT_PATH.relative_to(REPO_ROOT)),
        "verifiedDeliverables": verified_deliverables,
        "nativeReports": passed_reports,
        "remainingClosureStep": "independent review (pt-github-review)",
    }
    out = REPORTS_DIR / "chat-w11-closure-verdict.json"
    out.write_text(json.dumps(closure_verdict, indent=2) + "\n", encoding="utf-8")
    print(
        f"PASS: W11 completion audit — {len(verified_deliverables)} scan "
        f"deliverables, {len(passed_reports)} gate reports verified"
    )
    print(f"  Verdict: {out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
