from __future__ import annotations

import sys

from tooling.acceptance.core import EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.native_current_profile_two_client_e2e import (
    validate_current_profile_topology,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    load_report,
    validate_report,
    write_validation,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS,
)


REQUIRED_STEPS = {
    "station.identity",
    "fixture.existing",
    "client.authenticated",
    "runtime.source_identity",
    "runtime.cross_worktree",
    "command.reconciliation",
}


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
