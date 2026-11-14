#!/usr/bin/env python3
"""Fail-closed validator for the native group-call report."""

from __future__ import annotations

import sys
import re
from typing import Any

from tooling.acceptance.core import ArtifactRef, ArtifactSession, EvidenceStore, REPO_ROOT, current_artifact_ref
from tooling.acceptance.gates.chat.lifecycle_group_live import (
    ACTORS,
    DESKTOP_RUNTIME_IDENTITY,
    GATE_ID,
    REQUIRED_ASSERTIONS,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    load_report,
    require,
)
from tooling.acceptance.gates.chat.native_support import commits_match
from tooling.acceptance.fixtures.chat_native_reset import (
    GROUP_SFU_ADMISSION_CONTRACT,
    GROUP_SFU_SOURCE_REVISION,
)


REQUIRED_STEPS = {
    "station.identity",
    "fixture.reset",
    "client.authenticated",
    "group.create",
    "group-call.audio.join",
    "group-call.audio.media",
    "group-call.video.join",
    "group-call.video.media",
    "group-call.member-removal",
    "group-call.device-revoke",
    "group-call.session-revoke",
    "group-call.revoked-token-replay",
    "group-call.signal-reconnect",
    "group-call.refreshed-token-replay",
    "group-call.authority-restart",
    "group-call.authority-restart-replay",
    "group-call.sfu-restart",
    "group-call.sfu-restart-replay",
    "group-call.sfu-rejoin",
    "group-call.sfu-recovery-media",
    "group-call.memberReplay",
    "group-call.memberRefreshedReplay",
    "group-call.sessionReplay",
    "group-call.sessionRefreshedReplay",
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
    clients = evidence.get("clients")
    require(isinstance(clients, dict) and set(clients) == set(ACTORS), "three isolated clients are required")
    require(clients["charlie"].get("runtime") == "tauri-ios-simulator", "Charlie must use native Mobile")
    require(all(clients[actor].get("runtime") == DESKTOP_RUNTIME_IDENTITY for actor in ("alice", "bob")),
            "Alice and Bob must use native Desktop")
    ptids = {actor: client.get("ptid") for actor, client in clients.items()}
    require(len(set(ptids.values())) == 3 and all(ptids.values()), "distinct native actor identities are required")
    for phase in ("audio", "video", "lateJoin", "restart", "reconnected", "sfuRecovered"):
        snapshots = evidence.get(phase)
        actors = {"alice", "charlie"} if phase == "sfuRecovered" else set(ACTORS)
        require(
            isinstance(snapshots, dict)
            and set(snapshots) == actors,
            f"{phase} must include every authorized client",
        )
        rooms = {
            snapshot.get("roomName")
            for snapshot in snapshots.values()
            if isinstance(snapshot, dict)
        }
        require(
            len(rooms) == 1 and all(rooms),
            f"{phase} did not converge on one room",
        )
        require(all(snapshot.get("state") == "connected"
                    and {p.get("actorPtid") for p in snapshot.get("participants", [])} == {ptids[actor] for actor in actors}
                    for snapshot in snapshots.values()), f"{phase} roster is incomplete")
    for phase in ("audioMedia", "videoMedia", "restartMedia", "reconnectMedia", "sfuRecoveryMedia"):
        media = evidence.get(phase)
        actors = {"alice", "charlie"} if phase == "sfuRecoveryMedia" else set(ACTORS)
        require(
            isinstance(media, dict)
            and set(media) == actors,
            f"{phase} must include every authorized native media observation",
        )
        room_sids = {item.get("roomSid") for item in media.values()}
        participant_sids = {item.get("participantSid") for item in media.values()}
        require(len(room_sids) == 1 and all(room_sids) and len(participant_sids) == len(actors)
                and all(participant_sids), f"{phase} RTC identity is incomplete")
        kinds = {"audio"} if phase == "audioMedia" else {"audio", "video"}
        for actor, observation in media.items():
            deltas = observation.get("deltas")
            require(isinstance(deltas, list), f"{phase}/{actor} RTP deltas are required")
            for direction, peers in (("outbound", {ptids[actor]}),
                                      ("inbound", {ptids[peer] for peer in actors} - {ptids[actor]})):
                for peer in peers:
                    for kind in kinds:
                        require(any(row.get("direction") == direction and row.get("actorPtid") == peer
                                    and row.get("kind") == kind and row.get("trackSid")
                                    and int(row.get("bytes") or 0) > 0 and int(row.get("packets") or 0) > 0
                                    and (kind != "video" or int(row.get("frames") or 0) > 0)
                                    for row in deltas if isinstance(row, dict)),
                                f"{phase}/{actor} lacks live {direction} {kind} from {peer}")
    for phase in ("audioReleased", "videoReleased"):
        released = evidence.get(phase)
        require(isinstance(released, dict) and set(released) == set(ACTORS),
                f"{phase} must release every native participant")
        for actor, value in released.items():
            media = value.get("media") or {}
            require(not media.get("connected") and media.get("localLiveTracks") == 0
                    and media.get("tracks") == [], f"{phase}/{actor} has unreleased media")
    for phase, remaining in (("memberRemoval", {"alice", "charlie"}),
                             ("deviceRevocation", {"alice", "charlie"}),
                             ("sessionRevocation", {"charlie"})):
        value = evidence.get(phase)
        require(isinstance(value, dict), f"{phase} is required")
        released = (value.get("released") or {}).get("media") or {}
        require(not released.get("connected") and released.get("localLiveTracks") == 0
                and released.get("tracks") == [], f"{phase} capture was not released")
        snapshots = value.get("remaining") or {}
        expected = {ptids[actor] for actor in remaining}
        require(set(snapshots) == remaining and all(
            {p.get("actorPtid") for p in snapshot.get("participants", [])} == expected
            for snapshot in snapshots.values()), f"{phase} remaining roster did not exclude the revoked endpoint")
    reconnect = evidence.get("signalReconnect") or {}
    require(reconnect.get("requested") is True and reconnect.get("observedReconnecting") is True,
            "real SDK signal reconnect was not observed")
    require(all(evidence["videoMedia"][actor]["participantSid"] ==
                evidence["reconnectMedia"][actor]["participantSid"] for actor in ACTORS),
            "signal resume unexpectedly changed the RTC SID")
    restart = evidence.get("authorityRestart") or {}
    require(restart.get("beforeStartedAt") and restart.get("afterStartedAt")
            and restart["beforeStartedAt"] != restart["afterStartedAt"]
            and restart.get("beforeCommit") == restart.get("afterCommit"),
            "source-bound Authority restart was not observed")
    sfu_restart = evidence.get("sfuRestart") or {}
    before, after = sfu_restart.get("before") or {}, sfu_restart.get("after") or {}
    require(before.get("startedAt") and after.get("startedAt")
            and before["startedAt"] != after["startedAt"]
            and before.get("imageId") == after.get("imageId")
            and re.fullmatch(r"sha256:[0-9a-f]{64}", str(before.get("imageId") or "")),
            "source-bound SFU restart was not observed")
    require(all(before.get(field) == after.get(field) and before.get(field)
                for field in ("host", "url", "container", "composeProject")),
            "SFU restart target identity changed")
    require(all(item.get("health") == "healthy" and item.get("service") == "livekit"
                and item.get("sourceRevision") == GROUP_SFU_SOURCE_REVISION
                and item.get("admissionContract") == GROUP_SFU_ADMISSION_CONTRACT
                for item in (before, after)), "SFU admission source or health is mismatched")
    require(all(evidence["sfuRecoveryMedia"][actor]["participantSid"] !=
                evidence["restartMedia"][actor]["participantSid"] for actor in ("alice", "charlie")),
            "SFU recovery did not establish fresh authorized RTC sessions")
    for phase, token_kind in (("replay", "initial"), ("refreshedReplay", "refreshed"),
                              ("authorityRestartReplay", "refreshed"),
                              ("sfuRestartReplay", "refreshed"),
                              ("memberReplay", "initial"), ("memberRefreshedReplay", "refreshed"),
                              ("sessionReplay", "initial"), ("sessionRefreshedReplay", "refreshed")):
        replay = evidence.get(phase) or {}
        require(replay.get("denied") is True and replay.get("observedInitialDenial") is True
                and replay.get("mediaReleased") is True and replay.get("previousSid")
                and replay.get("replaySid") and replay["previousSid"] != replay["replaySid"]
                and replay.get("tokenKind") == token_kind,
                f"{phase} token replay was not proven denied on a new RTC SID")

    steps = runtime.get("steps")
    require(isinstance(steps, list), "step evidence is required")
    passed = {
        item.get("step")
        for item in steps
        if isinstance(item, dict) and item.get("status") == "pass"
    }
    require(REQUIRED_STEPS.issubset(passed), "required group-call steps are missing")
    selectors = {item.get("selector") for item in steps if isinstance(item, dict)
                 and item.get("status") == "pass" and item.get("client") == "charlie"}
    require({
        '[data-group-call-start="audio"]', '[data-group-call-start="video"]',
        '[data-action-id="group-call.microphone"]', '[data-action-id="group-call.camera"]',
        '[data-action-id="group-call.leave"]',
    }.issubset(selectors), "Mobile production UI actions are missing")


def validate_mixed_source(report: dict[str, Any], store: EvidenceStore) -> None:
    require(report.get("gate") == GATE_ID and report.get("status") == "PASS", "group report must pass")
    require(report.get("completionStatus") == "DONE" and report.get("proofStatus") == "PROVEN",
            "group report has incomplete proof")
    runtime = report.get("runtime") or {}
    source = runtime.get("sourceIdentity") or {}
    manifest = report.get("manifest") or {}
    require(manifest.get("environmentId") == "chat-mixed-native", "mixed-native manifest is required")
    published = store.read_json(current_artifact_ref("runtime/environment-manifest.json", repo_root=REPO_ROOT))
    require(all(manifest.get(field) == published.get(field) for field in
                ("source", "environmentId", "services", "clients", "actorManifest")),
            "report substituted its environment manifest")
    orchestrator = source.get("orchestrator") or {}
    require(orchestrator == manifest.get("source") and orchestrator.get("workspaceDigest") == "clean",
            "exact clean source identity is required for formal mixed proof")
    commit = str(orchestrator.get("commit") or "")
    require(re.fullmatch(r"[0-9a-f]{40}", commit) is not None, "source commit is missing")
    services = source.get("stations") or {}
    require(services == manifest.get("services") and services, "original Station attestations are required")
    for service_id, service in services.items():
        require(service.get("kind") == "station" and service.get("workspaceDigest") == "clean"
                and commits_match(str(service.get("liveCommit") or ""), commit)
                and commits_match(str((source.get("stationLive") or {}).get(service_id, {}).get("build_commit") or ""), commit)
                and re.fullmatch(r"[0-9a-f]{64}", str(service.get("protocolDigest") or "")) is not None,
                "Station source/protocol attestation is mismatched")
    binary = source.get("desktopBinary") or {}
    cell = source.get("desktopRuntimeCell") or {}
    require(binary.get("sourceCommit") == commit and re.fullmatch(r"[0-9a-f]{64}", str(binary.get("sha256") or "")),
            "native Desktop binary fingerprint is missing")
    require(cell.get("gateId") == GATE_ID and cell.get("cellId") == "desktop-macos-native"
            and cell.get("state") == "LEASED", "native Desktop runtime binding is missing")
    mobile = source.get("mobileBinary") or {}
    identity = mobile.get("identity") or {}
    require(identity.get("sourceCommit") == commit and identity.get("workspaceDigest") == "clean"
            and identity.get("platform") == "ios" and identity.get("harnessEnabled") is True
            and re.fullmatch(r"sha256:[0-9a-f]{64}", str(mobile.get("embeddedIdentitySha256") or "")),
            "native Mobile web/Rust build identity is mismatched")
    proofs = runtime.get("mobileBindingProofRefs")
    require(isinstance(proofs, list) and proofs, "Mobile parent binding proof is missing")
    for raw in proofs:
        ref = ArtifactRef.from_dict(raw)
        require(ref.gate_id == GATE_ID, "Mobile binding proof belongs to another Gate")
        store.read_json(ref)
    captures = runtime.get("mobileCaptures") or []
    require({item.get("phase") for item in captures} >= {"audio", "video"}, "Mobile media captures are missing")
    for capture in captures:
        for key in ("screenshot", "dom"):
            ref = ArtifactRef.from_dict(capture[key])
            require(ref.gate_id == GATE_ID, "Mobile capture belongs to another Gate")
            store.resolve(ref)
    assertions = {item.get("name") for item in report.get("assertions", [])
                  if isinstance(item, dict) and item.get("passed") is True}
    require(REQUIRED_ASSERTIONS.issubset(assertions), "required group assertions are missing")
    require(not (runtime.get("cleanup") or {}).get("cleanupErrors"), "native group cleanup failed")


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
    validate_mixed_source(report, store)
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
