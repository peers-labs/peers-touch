#!/usr/bin/env python3
"""Fail-closed validator for the native group-call report."""

from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import ArtifactRef, ArtifactSession, EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_group_live import (
    ACTORS,
    GATE_ID,
    REQUIRED_ASSERTIONS,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    load_report,
    require,
    validate_report,
)


REQUIRED_STEPS = {
    "station.identity",
    "fixture.reset",
    "client.authenticated",
    "mls.readiness",
    "group.create",
    "group.visible",
    "group-call.audio.join",
    "group-call.video.join",
}


def validate_group_live_report(report: dict[str, Any]) -> None:
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    require(
        runtime.get("journey") == "chat-group-live-lifecycle",
        "unexpected group-call journey",
    )
    evidence = runtime.get("groupLive")
    require(isinstance(evidence, dict), "group-call evidence is required")
    for phase in ("audio", "video", "lateJoin"):
        snapshots = evidence.get(phase)
        require(
            isinstance(snapshots, dict)
            and set(snapshots) == {"alice", "bob", "charlie"},
            f"{phase} must include all three clients",
        )
        rooms = {
            snapshot.get("roomName")
            for snapshot in snapshots.values()
            if isinstance(snapshot, dict)
        }
        require(
            len(rooms) == 1 and "" not in rooms,
            f"{phase} did not converge on one room",
        )
    for phase in ("audioMedia", "videoMedia"):
        media = evidence.get(phase)
        require(
            isinstance(media, dict)
            and set(media) == {"alice", "bob", "charlie"},
            f"{phase} must include all three native surfaces",
        )

    steps = runtime.get("steps")
    require(isinstance(steps, list), "step evidence is required")
    passed = {
        item.get("step")
        for item in steps
        if isinstance(item, dict) and item.get("status") == "pass"
    }
    require(REQUIRED_STEPS.issubset(passed), "required group-call steps are missing")


def write_validation(
    report: dict[str, Any],
    *,
    source_ref: ArtifactRef,
) -> ArtifactRef:
    session = ArtifactSession(repo_root=REPO_ROOT, gate_id=GATE_ID)
    return session.write_json(
        f"reports/{GATE_ID}-validation.json",
        {
            "artifactKind": "chat-group-live-validation",
            "status": "pass",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "phase": "CHAT-W05B",
            "bom": ["CHAT-G06", "CHAT-UR09"],
            "spec": ["CHAT-J09", "chat-group-live-lifecycle"],
            "gate": GATE_ID,
            "sourceArtifact": source_ref.to_dict(),
            "testedCommit": report["runtime"]["sourceIdentity"]["orchestrator"][
                "commit"
            ],
            "assertionCount": len(REQUIRED_ASSERTIONS),
        },
        role="validation",
    )


def main() -> int:
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    report, source_ref = load_report(store, GATE_ID)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=REQUIRED_STEPS,
        required_assertions=REQUIRED_ASSERTIONS,
        expected_journey="chat-group-live-lifecycle",
        expected_actor_roles=frozenset(ACTORS),
    )
    validate_group_live_report(report)
    validation_ref = write_validation(report, source_ref=source_ref)
    print("Chat Group Live E2E")
    print("===================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"chat group live validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
