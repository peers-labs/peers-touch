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
    CURRENT_PROFILE_ACTORS,
    CURRENT_PROFILE_GATE_ID,
    CURRENT_PROFILE_REQUIRED_ASSERTIONS,
    REQUIRED_ASSERTIONS,
)


REQUIRED_CURRENT_PROFILE_STEPS = (
    REQUIRED_STEPS - {"fixture.reset"}
    | {"fixture.existing", "runtime.instance_isolation", "client.restart", "conversation.restore"}
)
REQUIRED_CURRENT_PROFILE_ASSERTIONS = (
    REQUIRED_ASSERTIONS | CURRENT_PROFILE_REQUIRED_ASSERTIONS
)


def validate_current_profile_topology(report: dict[str, Any]) -> None:
    manifest = report.get("manifest")
    runtime = report.get("runtime")
    require(isinstance(manifest, dict) and isinstance(runtime, dict),
            "Runtime manifest and evidence are required")
    source = manifest.get("source")
    require(isinstance(source, dict), "Current source identity is required")
    clients = {
        str(client.get("actor") or ""): client
        for client in manifest.get("clients", [])
        if isinstance(client, dict)
    }
    require(set(clients) == set(CURRENT_PROFILE_ACTORS),
            "Current-profile clients must bind Alice and Bob")
    topology = runtime.get("instanceTopology")
    require(isinstance(topology, dict) and set(topology) == set(CURRENT_PROFILE_ACTORS),
            "Current-profile instance topology is required")
    for actor in CURRENT_PROFILE_ACTORS:
        identity = topology[actor]
        client = clients[actor]
        require(isinstance(identity, dict), f"{actor} instance identity is required")
        require(
            identity.get("clientId") == client.get("id")
            and identity.get("canonicalRoot") == str(Path(client["worktree"]).resolve())
            and identity.get("canonicalRoot") == str(Path(source["worktree"]).resolve())
            and identity.get("commit") == source.get("commit")
            and identity.get("workspaceDigest") == source.get("workspaceDigest")
            and re.fullmatch(r"[0-9a-f]{16}", str(identity.get("workspaceId") or "")) is not None
            and re.fullmatch(r"[0-9a-f]{64}", str(identity.get("binarySha256") or "")) is not None
            and isinstance(identity.get("processId"), int) and identity["processId"] > 0
            and str(identity.get("actorPtid") or "").startswith("ptid:")
            and bool(identity.get("deviceId"))
            and identity.get("profile") == client.get("profile")
            and identity.get("gatewayPort") == client.get("gateway_port")
            and identity.get("webdriverPort") == client.get("webdriver_port")
            and identity.get("storageRoot") == client.get("storage_root")
            and client.get("storage_lifecycle") == "ephemeral",
            f"{actor} current-source instance identity is incomplete or mismatched",
        )
    require(all(
        len({item[field] for item in topology.values()}) == 1
        for field in ("canonicalRoot", "workspaceId", "commit", "workspaceDigest", "binarySha256")
    ), "Current-profile instances must use one source snapshot and build")
    require(all(
        len({item[field] for item in topology.values()}) == 2
        for field in ("processId", "actorPtid", "deviceId", "profile",
                      "storageRoot", "gatewayPort", "webdriverPort")
    ), "Current-profile instances must have isolated actors, processes, devices, ports and storage")
    require(runtime.get("launchOrder") == runtime.get("directionOrder") == ["bob", "alice"],
            "Bob must launch and initiate before Alice")
    restarts = runtime.get("deviceRestartState")
    expected_messages = runtime.get("restartMessages")
    require(isinstance(expected_messages, list) and bool(expected_messages),
            "Restart must prove actual run-created messages")
    require(isinstance(restarts, dict) and set(restarts) == set(CURRENT_PROFILE_ACTORS),
            "Current-profile device restart evidence is required")
    for actor in CURRENT_PROFILE_ACTORS:
        state = restarts[actor]
        require(isinstance(state, dict), f"{actor} restart state is required")
        before, after, messages = state.get("before"), state.get("after"), state.get("messages")
        require(
            before == topology[actor] and isinstance(after, dict)
            and isinstance(after.get("processId"), int) and after["processId"] > 0
            and after.get("processId") != before["processId"]
            and all(after.get(field) == before[field] for field in before if field != "processId"),
            f"{actor} native restart must preserve the exact device and source state",
        )
        require(
            isinstance(messages, list) and len(messages) == len(expected_messages)
            and all(
                isinstance(observed, dict) and isinstance(expected, dict)
                and bool(expected.get("messageId")) and bool(expected.get("plaintext"))
                and observed.get("messageUlid") == expected["messageId"]
                and expected["plaintext"] in str(observed.get("text") or "")
                for observed, expected in zip(messages, expected_messages)
            ),
            f"{actor} native restart must retain exact visible plaintext and message identity",
        )
    cleanup = runtime.get("cleanup")
    require(
        isinstance(cleanup, dict) and cleanup.get("storageReleased") is True
        and not cleanup.get("retainedStorageRoots"),
        "Run-owned client storage must be released",
    )


def main() -> int:
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    report, source_ref = load_report(store, CURRENT_PROFILE_GATE_ID)
    validate_report(
        report, source_ref=source_ref, store=store, gate_id=CURRENT_PROFILE_GATE_ID,
        required_steps=REQUIRED_CURRENT_PROFILE_STEPS,
        required_assertions=REQUIRED_CURRENT_PROFILE_ASSERTIONS,
    )
    validate_current_profile_topology(report)
    validation_ref = write_validation(
        report, source_ref=source_ref, gate_id=CURRENT_PROFILE_GATE_ID,
        required_assertions=REQUIRED_CURRENT_PROFILE_ASSERTIONS,
    )
    print(f"[OK] Chat Native Current-Profile Two-Client E2E: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Chat native current-profile validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
