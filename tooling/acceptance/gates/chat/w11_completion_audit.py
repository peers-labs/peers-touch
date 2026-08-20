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
        report_path = REPORTS_DIR / f"{gate_id}.json"
        if not report_path.exists():
            result_path = REPORTS_DIR / "run.json"
            if result_path.exists():
                run = load_report(result_path)
                found = False
                for r in run.get("results", []):
                    if r.get("id") == gate_id and r.get("status") == "passed":
                        found = True
                        break
                if not found:
                    errors.append(f"scan gate {gate_id!r} did not pass")
            else:
                errors.append(f"scan gate report missing: {gate_id}")
        else:
            report = load_report(report_path)
            errors.extend(check_report_status(report, gate_id))

    for gate_id in sorted(required_gates):
        if gate_id == "chat-w11-completion-audit":
            continue
        if "native" in gate_id:
            filename = gate_id.replace("-e2e", "-run") + ".json"
        else:
            filename = gate_id + ".json"
        path = REPORTS_DIR / filename
        if path.exists():
            try:
                report = load_report(path)
                passed_reports.append(f"{filename} ({gate_id})")
                errors.extend(check_report_status(report, gate_id))
            except AssertionError as exc:
                errors.append(str(exc))
            continue

        result_path = REPORTS_DIR / "run.json"
        if result_path.exists():
            try:
                run = load_report(result_path)
                found = False
                for r in run.get("results", []):
                    if r.get("id") == gate_id and r.get("status") == "passed":
                        found = True
                        passed_reports.append(f"run.json:{gate_id}")
                        break
                if not found:
                    errors.append(f"required gate {gate_id!r} did not pass")
            except AssertionError as exc:
                errors.append(str(exc))
        else:
            errors.append(f"report missing: {path.relative_to(REPO_ROOT)}")

    validation_path = REPORTS_DIR / "chat-native-two-client-validation.json"
    if validation_path.exists():
        try:
            data = json.loads(validation_path.read_text(encoding="utf-8"))
            if data.get("status") != "pass":
                errors.append(f"validation status is {data.get('status')!r}, expected 'pass'")
            if data.get("completionStatus") != "DONE":
                errors.append(f"validation completionStatus is {data.get('completionStatus')!r}")
            if data.get("proofStatus") != "PROVEN":
                errors.append(f"validation proofStatus is {data.get('proofStatus')!r}")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"validation unreadable: {exc}")

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
