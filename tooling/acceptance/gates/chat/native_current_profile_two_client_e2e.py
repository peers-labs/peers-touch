from __future__ import annotations

import sys

from tooling.acceptance.core import EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    validate_report,
    write_validation,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    CURRENT_PROFILE_GATE_ID,
)


REQUIRED_CURRENT_PROFILE_STEPS = (
    REQUIRED_STEPS - {"fixture.reset"} | {"fixture.existing"}
)


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, CURRENT_PROFILE_GATE_ID)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=CURRENT_PROFILE_GATE_ID,
        required_steps=REQUIRED_CURRENT_PROFILE_STEPS,
    )
    validation_ref = write_validation(
        report,
        source_ref=source_ref,
        gate_id=CURRENT_PROFILE_GATE_ID,
    )
    print("Chat Native Current-Profile Two-Client E2E")
    print("==========================================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat native current-profile two-client validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
