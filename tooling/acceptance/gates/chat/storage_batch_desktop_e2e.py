#!/usr/bin/env python3
"""Validate native Desktop batch-clear evidence."""

from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import ArtifactSession, EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    require,
    validate_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
)
from tooling.acceptance.gates.chat.storage_batch_desktop_runner import (
    BATCH_REQUIRED_ASSERTIONS,
    BATCH_REQUIRED_STEPS,
    GATE_ID,
)
from tooling.acceptance.gates.chat.storage_governance_runner import (
    STORAGE_REQUIRED_ASSERTIONS,
    STORAGE_REQUIRED_STEPS,
)


def validate_batch_report(
    report: dict[str, Any],
    *,
    store: EvidenceStore,
) -> None:
    source_report, source_ref = load_report(store, GATE_ID)
    require(source_report == report, "Desktop batch report changed during validation")
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=(
            REQUIRED_STEPS
            | STORAGE_REQUIRED_STEPS
            | BATCH_REQUIRED_STEPS
        ),
        required_assertions=(
            REQUIRED_ASSERTIONS
            | STORAGE_REQUIRED_ASSERTIONS
            | BATCH_REQUIRED_ASSERTIONS
        ),
    )
    batch = report.get("runtime", {}).get("batchClear")
    require(isinstance(batch, dict), "Desktop batch result is required")
    require(batch.get("succeeded") == 2, "Desktop batch did not clear two conversations")
    require(batch.get("failed") == 0, "Desktop batch reported failed conversations")
    require(
        int(batch.get("releasedBytes") or 0) > 0,
        "Desktop batch did not report released physical bytes",
    )
    require(batch.get("restartStable") is True, "Desktop batch restart proof is missing")


def main() -> int:
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    report, source_ref = load_report(store, GATE_ID)
    validate_batch_report(report, store=store)
    output = {
        "artifactKind": "chat-storage-desktop-batch-clear-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "chat-storage-batch-clear",
        "bom": ["CSG-G07"],
        "spec": ["chat-storage-batch-clear"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"]["orchestrator"]["commit"],
        "assertionCount": len(
            REQUIRED_ASSERTIONS
            | STORAGE_REQUIRED_ASSERTIONS
            | BATCH_REQUIRED_ASSERTIONS
        ),
    }
    session = ArtifactSession(repo_root=REPO_ROOT, gate_id=GATE_ID)
    validation_ref = session.write_json(
        "reports/chat-storage-desktop-batch-clear-validation.json",
        output,
        role="validation",
    )
    print("Chat Storage Desktop Batch Clear E2E")
    print("====================================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat storage Desktop batch validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
