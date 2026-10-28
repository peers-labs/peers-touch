from __future__ import annotations

import hashlib
import sys

from tooling.acceptance.core import EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.native_current_profile_two_client_e2e import (
    validate_current_profile_topology,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    load_report,
    require,
    validate_report,
    write_validation,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS,
    reconciled_command_snapshot_outcome,
    submitted_command_snapshot_is_exact,
)


REQUIRED_STEPS = {
    "station.identity",
    "fixture.existing",
    "client.authenticated",
    "runtime.source_identity",
    "runtime.instance_isolation",
    "conversation.open",
    "command.reconciliation.ui_send",
    "command.reconciliation.fixture",
    "command.reconciliation.restart",
    "command.reconciliation",
    "command.reconciliation.receiver_visible",
    "client.restart",
    "conversation.restore",
}

def validate_submitted_command_recovery(report: dict) -> None:
    runtime = report["runtime"]
    created = runtime.get("createdSubmittedCommand")
    reconciliation = runtime.get("submittedCommandReconciliation")
    require(isinstance(created, dict) and isinstance(reconciliation, dict),
            "Run-created submitted-command evidence is required")
    target = reconciliation.get("target")
    require(
        isinstance(target, dict) and all(
            target.get(field) == created.get(field)
            for field in ("actor", "conversationId", "messageId", "commandId", "outcome")
        ) and target.get("outcome") == "accepted",
        "Recovery must converge the exact run-created command",
    )
    initial = reconciliation.get("initialSenderSnapshot")
    final = reconciliation.get("senderSnapshot")
    visible = reconciliation.get("receiverVisible")
    prepared = created.get("preparedSnapshot")
    require(
        isinstance(initial, dict) and isinstance(final, dict)
        and isinstance(prepared, dict) and isinstance(prepared.get("outbox"), dict)
        and prepared["outbox"].get("state") == "pending"
        and bool(target.get("commandSha256"))
        and prepared["outbox"].get("commandSha256") == target["commandSha256"]
        and submitted_command_snapshot_is_exact(initial, target["commandId"], target["messageId"])
        and initial["outbox"].get("commandSha256") == target["commandSha256"]
        and reconciled_command_snapshot_outcome(
            final, target["commandId"], target["messageId"], target.get("commandSha256", ""),
        ) == "accepted"
        and isinstance(visible, dict)
        and bool(created.get("plaintext"))
        and created.get("plaintextSha256") == hashlib.sha256(created["plaintext"].encode()).hexdigest()
        and visible.get("messageUlid") == target["messageId"]
        and created["plaintext"] in str(visible.get("text") or ""),
        "Recovery requires exact submitted state, canonical convergence and receiver-visible plaintext",
    )
    steps = [step.get("step") for step in runtime["steps"] if step.get("status") == "pass"]
    required_order = [
        "conversation.open", "command.reconciliation.ui_send",
        "command.reconciliation.fixture", "command.reconciliation.restart",
        "command.reconciliation.receiver_visible", "command.reconciliation",
    ]
    positions = [steps.index(name) for name in required_order]
    require(positions == sorted(positions), "Recovery must observe UI send, fault, real restart and convergence in order")


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(
        store,
        SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    )
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=SUBMITTED_COMMAND_RECOVERY_GATE_ID,
        required_steps=REQUIRED_STEPS,
        required_assertions=SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS,
    )
    validate_current_profile_topology(report)
    validate_submitted_command_recovery(report)
    validation_ref = write_validation(
        report,
        source_ref=source_ref,
        gate_id=SUBMITTED_COMMAND_RECOVERY_GATE_ID,
        required_assertions=SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS,
    )
    print("Chat Native Submitted-Command Recovery E2E")
    print("==========================================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat native submitted-command validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
