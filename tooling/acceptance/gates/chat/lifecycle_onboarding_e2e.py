from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    REPO_ROOT,
)
from tooling.acceptance.gates.chat.lifecycle_onboarding import (
    GATE_ID,
    ONBOARDING_REQUIRED_ASSERTIONS,
    accepted_conversation_id,
)
from tooling.acceptance.gates.chat.native_current_profile_two_client_e2e import (
    REQUIRED_CURRENT_PROFILE_ASSERTIONS,
    REQUIRED_CURRENT_PROFILE_STEPS,
    validate_current_profile_topology,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    load_report,
    require,
    validate_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
)


REQUIRED_ONBOARDING_STEPS = REQUIRED_CURRENT_PROFILE_STEPS | {
    "relationship.normalize",
    "discovery.search",
    "relationship.reject",
    "relationship.retry",
    "relationship.accept",
}
REQUIRED_ONBOARDING_ASSERTIONS = (
    REQUIRED_ASSERTIONS
    | REQUIRED_CURRENT_PROFILE_ASSERTIONS
    | ONBOARDING_REQUIRED_ASSERTIONS
)


def validate_onboarding_report(report: dict[str, Any]) -> None:
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    onboarding = runtime.get("onboarding")
    require(
        isinstance(onboarding, dict),
        "onboarding evidence is required",
    )
    discovery = onboarding.get("discovery")
    retry = onboarding.get("retry")
    snapshots = onboarding.get("snapshots")
    require(
        isinstance(discovery, dict)
        and isinstance(retry, dict)
        and discovery.get("pendingRequestId")
        and retry.get("pendingRequestId")
        and discovery.get("pendingRequestId")
        != retry.get("pendingRequestId"),
        "onboarding reject/retry identities are incomplete",
    )
    require(
        isinstance(snapshots, list)
        and len(snapshots) == 2
        and accepted_conversation_id((snapshots[0], snapshots[1]))
        == runtime.get("conversationId"),
        "onboarding relationship did not converge on one Direct conversation",
    )


def write_onboarding_validation(
    report: dict[str, Any],
    *,
    source_ref: ArtifactRef,
) -> ArtifactRef:
    output = {
        "artifactKind": "chat-lifecycle-onboarding-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "CHAT-W01",
        "bom": ["CHAT-G01", "CHAT-G02", "CHAT-G03", "CHAT-G04"],
        "spec": ["CHAT-J01", "chat-native-visible-clients"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(REQUIRED_ONBOARDING_ASSERTIONS),
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
        required_steps=REQUIRED_ONBOARDING_STEPS,
        required_assertions=REQUIRED_ONBOARDING_ASSERTIONS,
    )
    validate_current_profile_topology(report)
    validate_onboarding_report(report)
    validation_ref = write_onboarding_validation(
        report,
        source_ref=source_ref,
    )
    print("Chat Lifecycle Onboarding E2E")
    print("=============================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat lifecycle onboarding validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
