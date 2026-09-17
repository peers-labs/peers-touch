from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

from tooling.acceptance.core import EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    require,
    validate_report,
    write_validation,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    CURRENT_PROFILE_ACTOR_WORKTREES,
    CURRENT_PROFILE_GATE_ID,
    CURRENT_PROFILE_INITIAL_SENDER,
    CURRENT_PROFILE_REQUIRED_ASSERTIONS,
    REQUIRED_ASSERTIONS,
)


REQUIRED_CURRENT_PROFILE_STEPS = (
    REQUIRED_STEPS - {"fixture.reset"}
    | {"fixture.existing", "runtime.cross_worktree"}
)
REQUIRED_CURRENT_PROFILE_ASSERTIONS = (
    REQUIRED_ASSERTIONS | CURRENT_PROFILE_REQUIRED_ASSERTIONS
)


def validate_current_profile_topology(report: dict[str, Any]) -> None:
    manifest = report.get("manifest")
    require(isinstance(manifest, dict), "runtime manifest is required")
    raw_clients = manifest.get("clients")
    require(
        isinstance(raw_clients, list),
        "runtime manifest clients are required",
    )
    clients = {
        str(client.get("actor") or ""): client
        for client in raw_clients
        if isinstance(client, dict)
    }
    require(
        set(clients) == set(CURRENT_PROFILE_ACTOR_WORKTREES),
        "current-profile clients must bind Alice and Bob",
    )

    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    topology = runtime.get("worktreeTopology")
    require(
        isinstance(topology, dict)
        and set(topology) == set(CURRENT_PROFILE_ACTOR_WORKTREES),
        "current-profile worktree topology is required",
    )
    source = manifest.get("source")
    source_commit = str(
        source.get("commit") if isinstance(source, dict) else ""
    )
    for actor, expected_name in CURRENT_PROFILE_ACTOR_WORKTREES.items():
        identity = topology[actor]
        require(
            isinstance(identity, dict),
            f"{actor} worktree identity must be an object",
        )
        client_root = Path(
            str(clients[actor].get("worktree") or "")
        ).expanduser().resolve()
        require(
            identity.get("clientId") == clients[actor].get("id")
            and identity.get("logicalName") == expected_name
            and identity.get("expectedLogicalName") == expected_name
            and identity.get("canonicalRoot") == str(client_root)
            and identity.get("clean") is True
            and re.fullmatch(
                r"[0-9a-f]{16}",
                str(identity.get("workspaceId") or ""),
            )
            is not None
            and re.fullmatch(
                r"[0-9a-f]{16}",
                str(identity.get("repositoryId") or ""),
            )
            is not None
            and re.fullmatch(
                r"[0-9a-f]{40,64}",
                str(identity.get("head") or ""),
            )
            is not None
            and re.fullmatch(
                r"[0-9a-f]{40,64}",
                str(identity.get("tree") or ""),
            )
            is not None,
            f"{actor} worktree identity is incomplete or mismatched",
        )
    require(
        len(
            {
                str(topology[actor].get("canonicalRoot") or "")
                for actor in CURRENT_PROFILE_ACTOR_WORKTREES
            }
        )
        == 2
        and len(
            {
                str(topology[actor].get("workspaceId") or "")
                for actor in CURRENT_PROFILE_ACTOR_WORKTREES
            }
        )
        == 2,
        "current-profile clients must use distinct worktrees",
    )
    require(
        len(
            {
                str(topology[actor].get("repositoryId") or "")
                for actor in CURRENT_PROFILE_ACTOR_WORKTREES
            }
        )
        == 1,
        "current-profile clients must belong to one Git repository",
    )
    require(
        topology["alice"].get("tree") == topology["bob"].get("tree"),
        "current-profile worktrees must have identical source trees",
    )
    require(
        topology[CURRENT_PROFILE_INITIAL_SENDER].get("head")
        == source_commit,
        "group-chat initiator must match the orchestrator source commit",
    )
    expected_direction = [
        CURRENT_PROFILE_INITIAL_SENDER,
        next(
            actor
            for actor in CURRENT_PROFILE_ACTOR_WORKTREES
            if actor != CURRENT_PROFILE_INITIAL_SENDER
        ),
    ]
    require(
        runtime.get("launchOrder") == expected_direction
        and runtime.get("directionOrder") == expected_direction,
        "peers-group-chat must launch and initiate before peers-chat-high-chat",
    )
    persistent_state = runtime.get("persistentDeviceState")
    require(
        isinstance(persistent_state, dict)
        and set(persistent_state) == set(CURRENT_PROFILE_ACTOR_WORKTREES),
        "current-profile persistent device state evidence is required",
    )
    storage_roots: set[str] = set()
    for actor in CURRENT_PROFILE_ACTOR_WORKTREES:
        state = persistent_state[actor]
        require(
            isinstance(state, dict)
            and state.get("storageLifecycle") == "persistent"
            and state.get("storageRoot")
            == clients[actor].get("storage_root")
            and clients[actor].get("storage_lifecycle") == "persistent",
            f"{actor} persistent device state is incomplete or mismatched",
        )
        storage_roots.add(str(state["storageRoot"]))
    require(
        len(storage_roots) == len(CURRENT_PROFILE_ACTOR_WORKTREES),
        "current-profile persistent device states must be isolated",
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
        required_assertions=REQUIRED_CURRENT_PROFILE_ASSERTIONS,
    )
    validate_current_profile_topology(report)
    validation_ref = write_validation(
        report,
        source_ref=source_ref,
        gate_id=CURRENT_PROFILE_GATE_ID,
        required_assertions=REQUIRED_CURRENT_PROFILE_ASSERTIONS,
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
