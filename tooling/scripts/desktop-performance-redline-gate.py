#!/usr/bin/env python3
"""
Desktop Performance Red-Line CI Gate (Phase 1f).

Runs sampler gate against telemetry evidence to verify all 6 performance
budget invariants (INV-1~INV-6) pass at P95.

Usage:
  python3 desktop-performance-redline-gate.py --evidence <path> [--blocking]

Decision references: D-10 (budgets), D-11 (P95 threshold), D-13 (Station mirror)
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# ── Budget thresholds (D-10) ─────────────────────────────────────────────

BUDGETS = {
    "INV-1": {"metric": "click_to_first_feedback_ms", "threshold": 50, "type": "p95_max"},
    "INV-2a": {"metric": "click_to_visible_primary_ms", "threshold": 100, "type": "p95_max"},
    "INV-2b": {"metric": "click_to_visible_secondary_ms", "threshold": 80, "type": "p95_max"},
    "INV-3": {"metric": "contextmenu_to_visible_ms", "threshold": 50, "type": "p95_max"},
    "INV-4": {"metric": "longtask_during_interaction_ms", "threshold": 50, "type": "p95_max"},
    "INV-5": {"metric": "hidden_render_during_switch", "threshold": 0, "type": "count_zero"},
    "INV-6": {"metric": "invoke_in_click_frame", "threshold": 0, "type": "count_zero"},
}

MIN_SAMPLES = 30
WARMUP_EXCLUDE = 3


def compute_p95(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = int(len(sorted_vals) * 0.95)
    return sorted_vals[min(idx, len(sorted_vals) - 1)]


def evaluate_invariant(inv_id: str, spec: dict[str, Any], samples: list[dict[str, Any]]) -> dict[str, Any]:
    metric = spec["metric"]
    values = [s[metric] for s in samples if metric in s]

    if len(values) < MIN_SAMPLES:
        return {"id": inv_id, "status": "insufficient_data", "count": len(values), "required": MIN_SAMPLES}

    # Exclude warmup
    values = values[WARMUP_EXCLUDE:]

    if spec["type"] == "p95_max":
        p95 = compute_p95(values)
        passed = p95 <= spec["threshold"]
        return {
            "id": inv_id,
            "status": "pass" if passed else "fail",
            "p95": round(p95, 2),
            "threshold": spec["threshold"],
            "sample_count": len(values),
        }
    elif spec["type"] == "count_zero":
        violations = sum(1 for v in values if v > 0)
        passed = violations == 0
        return {
            "id": inv_id,
            "status": "pass" if passed else "fail",
            "violations": violations,
            "sample_count": len(values),
        }
    return {"id": inv_id, "status": "unknown_type"}


def run_gate(evidence_path: Path, blocking: bool) -> int:
    if not evidence_path.exists():
        print(f"ERROR: Evidence file not found: {evidence_path}", file=sys.stderr)
        return 1

    with open(evidence_path) as f:
        data = json.load(f)

    samples = data.get("samples", [])
    runtime = data.get("runtime", "unknown")

    print(f"=== Desktop Performance Red-Line Gate ===")
    print(f"Runtime: {runtime}")
    print(f"Total samples: {len(samples)}")
    print(f"Min required: {MIN_SAMPLES} (excluding {WARMUP_EXCLUDE} warmup)")
    print()

    results = []
    all_pass = True

    for inv_id, spec in BUDGETS.items():
        result = evaluate_invariant(inv_id, spec, samples)
        results.append(result)
        status_icon = "✓" if result["status"] == "pass" else "✗" if result["status"] == "fail" else "?"
        print(f"  {status_icon} {inv_id}: {result['status']} — {json.dumps({k: v for k, v in result.items() if k not in ('id', 'status')})}")
        if result["status"] != "pass":
            all_pass = False

    print()
    overall = "PASS" if all_pass else "FAIL"
    print(f"Overall: {overall}")

    # Write report
    report = {
        "gate": "desktop-performance-redline",
        "runtime": runtime,
        "status": overall.lower(),
        "results": results,
        "blocking": blocking,
    }
    report_path = evidence_path.parent / "redline-gate-report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Report written: {report_path}")

    if blocking and not all_pass:
        print("\n❌ BLOCKED: Red-line gate failed in blocking mode.", file=sys.stderr)
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Desktop Performance Red-Line CI Gate")
    parser.add_argument("--evidence", required=True, help="Path to evidence JSON file")
    parser.add_argument("--blocking", action="store_true", help="Exit non-zero on failure (fail-closed)")
    args = parser.parse_args()

    exit_code = run_gate(Path(args.evidence), args.blocking)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
