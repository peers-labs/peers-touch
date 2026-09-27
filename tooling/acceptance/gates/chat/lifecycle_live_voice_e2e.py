#!/usr/bin/env python3
"""Fail-closed validator for the one-to-one live voice/video report."""

from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    REPO_ROOT,
)
from tooling.acceptance.gates.chat.lifecycle_live_voice import (
    GATE_ID,
    REQUIRED_LIVE_VOICE_ASSERTIONS,
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


REQUIRED_LIVE_VOICE_STEPS = REQUIRED_STEPS | {
    "call.audio.lifecycle",
    "call.audio.reject",
    "call.audio.no-answer",
    "call.video.lifecycle",
    "call.text-during-active",
    "call.resources-released",
}
REQUIRED_LIVE_VOICE_REPORT_ASSERTIONS = (
    REQUIRED_ASSERTIONS | REQUIRED_LIVE_VOICE_ASSERTIONS
)


def _has_live_track(snapshot: object, kind: str, side: str) -> bool:
    if not isinstance(snapshot, dict):
        return False
    tracks = snapshot.get(f"{side}Tracks")
    return isinstance(tracks, list) and any(
        isinstance(track, dict)
        and track.get("kind") == kind
        and track.get("readyState") == "live"
        for track in tracks
    )


def validate_live_voice_report(report: dict[str, Any]) -> None:
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    evidence = runtime.get("liveVoice")
    require(isinstance(evidence, dict), "live voice evidence is required")

    audio = evidence.get("audioLifecycle")
    video = evidence.get("videoLifecycle")
    text = evidence.get("textDuringCall")
    released = evidence.get("resourcesReleased")
    audio_media = audio.get("media") if isinstance(audio, dict) else None
    require(
        isinstance(audio, dict)
        and isinstance(audio_media, dict)
        and _has_live_track(audio_media.get("alice"), "audio", "local")
        and _has_live_track(audio_media.get("alice"), "audio", "remote")
        and _has_live_track(audio_media.get("bob"), "audio", "local")
        and _has_live_track(audio_media.get("bob"), "audio", "remote"),
        "bilateral audio media evidence is incomplete",
    )
    video_media = video.get("media") if isinstance(video, dict) else None
    require(
        isinstance(video, dict)
        and isinstance(video_media, dict)
        and _has_live_track(video_media.get("alice"), "video", "local")
        and _has_live_track(video_media.get("bob"), "video", "remote")
        and _has_live_track(video.get("recovered"), "audio", "local")
        and _has_live_track(video.get("recovered"), "video", "local"),
        "video or reconnect media evidence is incomplete",
    )
    device_switch = (
        video.get("deviceSwitch") if isinstance(video, dict) else None
    )
    require(
        isinstance(device_switch, dict)
        and isinstance(device_switch.get("sender"), dict)
        and device_switch["sender"].get("switched") is True
        and device_switch["sender"].get("newTrackLive") is True
        and _has_live_track(device_switch.get("receiver"), "video", "remote"),
        "camera-device switch evidence is incomplete",
    )
    require(
        isinstance(text, dict)
        and isinstance(text.get("sent"), dict)
        and isinstance(text.get("received"), dict)
        and text["sent"].get("messageUlid")
        == text["received"].get("messageUlid"),
        "text-during-call receiver evidence is incomplete",
    )
    require(
        isinstance(released, dict)
        and all(
            isinstance(released.get(actor), dict)
            and released[actor].get("state") == "ended"
            and not released[actor].get("localTracks")
            and not released[actor].get("remoteTracks")
            for actor in ("alice", "bob")
        ),
        "post-call media release evidence is incomplete",
    )


def write_live_voice_validation(
    report: dict[str, Any],
    *,
    source_ref: ArtifactRef,
) -> ArtifactRef:
    output = {
        "artifactKind": "chat-live-voice-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "CHAT-W05",
        "bom": ["CHAT-G06", "CHAT-UR07"],
        "spec": ["CHAT-J05", "chat-live-voice-lifecycle"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(REQUIRED_LIVE_VOICE_REPORT_ASSERTIONS),
    }
    session = ArtifactSession(repo_root=REPO_ROOT, gate_id=GATE_ID)
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
        required_steps=REQUIRED_LIVE_VOICE_STEPS,
        required_assertions=REQUIRED_LIVE_VOICE_REPORT_ASSERTIONS,
    )
    validate_live_voice_report(report)
    validation_ref = write_live_voice_validation(
        report,
        source_ref=source_ref,
    )
    print("Chat Live Voice E2E")
    print("===================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"chat live voice validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
