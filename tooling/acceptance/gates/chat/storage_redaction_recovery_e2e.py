#!/usr/bin/env python3
"""Validate native CSG-J05/J06 redaction and Recovery evidence."""

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
from tooling.acceptance.gates.chat.storage_redaction_recovery_runner import (
    GATE_ID,
    REDACTION_REQUIRED_ASSERTIONS,
    REDACTION_REQUIRED_STEPS,
    redaction_snapshot_is_valid,
)


def validate_redaction_recovery_report(
    report: dict[str, Any],
    *,
    store: EvidenceStore,
) -> None:
    source_report, source_ref = load_report(store, GATE_ID)
    require(
        source_report == report,
        "redaction recovery report changed during validation",
    )
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=REQUIRED_STEPS | REDACTION_REQUIRED_STEPS,
        required_assertions=REQUIRED_ASSERTIONS
        | REDACTION_REQUIRED_ASSERTIONS,
    )
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    evidence = runtime.get("redactionRecovery")
    require(
        isinstance(evidence, dict),
        "redaction Recovery evidence is required",
    )
    for phase in ("immediate", "restarted", "restored"):
        phase_evidence = evidence.get(phase)
        require(
            isinstance(phase_evidence, dict),
            f"{phase} redaction evidence is required",
        )
        require(
            redaction_snapshot_is_valid(
                phase_evidence.get("aliceHide"),
                kind="hidden_for_actor",
                require_cleanup=phase != "restored",
            ),
            f"{phase} actor-hide evidence is invalid",
        )
        retract = phase_evidence.get("retract")
        require(
            isinstance(retract, dict),
            f"{phase} retract evidence is required",
        )
        for actor in ("alice", "bob"):
            require(
                redaction_snapshot_is_valid(
                    retract.get(actor),
                    kind="retracted",
                    require_cleanup=phase != "restored",
                ),
                f"{phase} {actor} retract evidence is invalid",
            )
    restored_bob_hide = evidence["restored"].get("bobHide")
    require(
        isinstance(restored_bob_hide, dict)
        and isinstance(restored_bob_hide.get("projection"), dict)
        and restored_bob_hide["projection"].get("plaintextEmpty") is False,
        "Bob must retain the actor-hidden plaintext after Recovery",
    )


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, GATE_ID)
    validate_redaction_recovery_report(report, store=store)
    output = {
        "artifactKind": "chat-storage-redaction-recovery-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "chat-storage-redaction-recovery",
        "bom": ["CSG-G04"],
        "spec": ["chat-storage-redaction-recovery"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(
            REQUIRED_ASSERTIONS | REDACTION_REQUIRED_ASSERTIONS
        ),
    }
    session = ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=GATE_ID,
    )
    validation_ref = session.write_json(
        "reports/chat-storage-redaction-recovery-validation.json",
        output,
        role="validation",
    )
    print("Chat Storage Redaction Recovery E2E")
    print("===================================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat storage redaction recovery validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
