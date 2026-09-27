#!/usr/bin/env python3
"""Validate native CSG-J01 storage-accounting evidence."""

from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import (
    ArtifactSession,
    EvidenceStore,
    REPO_ROOT,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    require,
    validate_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
)
from tooling.acceptance.gates.chat.storage_governance_runner import (
    GATE_ID,
    STORAGE_REQUIRED_ASSERTIONS,
    STORAGE_REQUIRED_STEPS,
    storage_snapshot_is_valid,
)


def validate_storage_report(
    report: dict[str, Any],
    *,
    store: EvidenceStore,
) -> None:
    source_report, source_ref = load_report(store, GATE_ID)
    require(
        source_report == report,
        "storage accounting report changed during validation",
    )
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=REQUIRED_STEPS | STORAGE_REQUIRED_STEPS,
        required_assertions=REQUIRED_ASSERTIONS | STORAGE_REQUIRED_ASSERTIONS,
    )
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    snapshot = runtime.get("storageSnapshot")
    conversation_id = str(runtime.get("conversationId") or "")
    require(bool(conversation_id), "storage conversation identity is required")
    require(
        storage_snapshot_is_valid(snapshot, conversation_id),
        "native storage snapshot is incomplete or fabricated",
    )


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, GATE_ID)
    validate_storage_report(report, store=store)
    output = {
        "artifactKind": "chat-storage-accounting-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "chat-storage-accounting",
        "bom": ["CSG-G01"],
        "spec": ["chat-storage-observability"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(
            REQUIRED_ASSERTIONS | STORAGE_REQUIRED_ASSERTIONS
        ),
    }
    session = ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=GATE_ID,
    )
    validation_ref = session.write_json(
        "reports/chat-storage-accounting-validation.json",
        output,
        role="validation",
    )
    print("Chat Storage Accounting E2E")
    print("===========================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat storage accounting validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
