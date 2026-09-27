from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    REPO_ROOT,
)
from tooling.acceptance.gates.chat.lifecycle_presence_layout import (
    GATE_ID,
    REQUIRED_PRESENCE_LAYOUT_ASSERTIONS,
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


REQUIRED_PRESENCE_LAYOUT_STEPS = REQUIRED_STEPS | {
    "presence.focus",
    "presence.unknown",
    "layout.message-metadata",
    "layout.unread",
    "presence.lease",
}
REQUIRED_PRESENCE_LAYOUT_REPORT_ASSERTIONS = (
    REQUIRED_ASSERTIONS
    | REQUIRED_PRESENCE_LAYOUT_ASSERTIONS
)


def validate_presence_layout_report(report: dict[str, Any]) -> None:
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    evidence = runtime.get("presenceLayout")
    require(
        isinstance(evidence, dict),
        "presence/layout evidence is required",
    )
    focus = evidence.get("focus")
    unknown = evidence.get("unknown")
    messages = evidence.get("messages")
    unread = evidence.get("unread")
    lease = evidence.get("lease")
    require(
        isinstance(focus, dict)
        and len(focus.get("focusSamples") or []) == 3,
        "focus-transition presence evidence is incomplete",
    )
    require(
        isinstance(unknown, dict)
        and (unknown.get("proxy") or {}).get("interceptedCount", 0) >= 1
        and (unknown.get("recovered") or {}).get("valid") is True,
        "unavailable-authority and recovery evidence is incomplete",
    )
    require(
        isinstance(messages, dict)
        and len(messages.get("messageIds") or []) == 3
        and bool(messages.get("threadMessageId")),
        "message geometry evidence is incomplete",
    )
    require(
        isinstance(unread, dict)
        and int((unread.get("single") or {}).get("unread") or 0) == 1
        and int((unread.get("capped") or {}).get("unread") or 0) >= 100
        and (unread.get("capped") or {}).get("badgeText") == "99+",
        "unread geometry evidence is incomplete",
    )
    require(
        isinstance(lease, dict)
        and float(
            (lease.get("result") or {}).get("elapsedSeconds") or 0
        )
        >= float(lease.get("requiredObservationSeconds") or 0)
        > float(lease.get("leaseSeconds") or 0),
        "presence lease evidence is incomplete",
    )


def write_presence_layout_validation(
    report: dict[str, Any],
    *,
    source_ref: ArtifactRef,
) -> ArtifactRef:
    output = {
        "artifactKind": "chat-presence-layout-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "CHAT-W04A",
        "bom": [
            "CHAT-G04",
            "CHAT-G05",
            "CHAT-G08",
            "CHAT-UR14",
            "CHAT-UR15",
            "CHAT-UR16",
        ],
        "spec": ["CHAT-J02", "chat-presence-layout-stability"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(
            REQUIRED_PRESENCE_LAYOUT_REPORT_ASSERTIONS
        ),
    }
    session = ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=GATE_ID,
    )
    return session.write_json(
        f"reports/{GATE_ID}-validation.json",
        output,
        role="validation",
    )


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, GATE_ID)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=REQUIRED_PRESENCE_LAYOUT_STEPS,
        required_assertions=REQUIRED_PRESENCE_LAYOUT_REPORT_ASSERTIONS,
    )
    validate_presence_layout_report(report)
    validation_ref = write_presence_layout_validation(
        report,
        source_ref=source_ref,
    )
    print("Chat Presence And Layout E2E")
    print("============================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat presence/layout validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
