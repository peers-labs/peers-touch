#!/usr/bin/env python3
"""Prove one-to-one voice and video call lifecycle on Native Desktop."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import json
import time
from typing import Any

from tooling.acceptance.core import AcceptanceGate, DriverError, GateError
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    LIVE_VOICE_GATE_ID,
    NativeTwoClientGate,
    message_snapshot,
    send_text,
)


GATE_ID = LIVE_VOICE_GATE_ID
REPORT_PATH = None
STEP_TIMEOUT = 120.0
RING_TIMEOUT = 50.0
REQUIRED_LIVE_VOICE_ASSERTIONS = {
    "call_audio_outgoing_ring",
    "call_audio_callee_incoming",
    "call_audio_accept_active",
    "call_audio_receiver_media_live",
    "call_audio_hangup_ended",
    "call_audio_reject",
    "call_audio_no_answer",
    "call_video_outgoing_ring",
    "call_video_accept_active",
    "call_video_local_preview_live",
    "call_video_receiver_media_live",
    "call_video_compact_layout",
    "call_video_chat_fill_layout",
    "call_video_fullscreen_layout",
    "call_video_toggle_mic",
    "call_video_toggle_camera",
    "call_video_device_switch",
    "call_reconnect_entered",
    "call_reconnect_recovered",
    "call_video_hangup_ended",
    "text_usable_during_call",
    "call_resources_released",
}


def _call_snapshot(client: TauriSession, peer_ptid: str) -> dict[str, Any] | None:
    result = async_harness(client, "callSnapshot", {"peerPtid": peer_ptid})
    if isinstance(result, dict):
        return result.get("snapshot")
    return None


def _wait_call_state(
    client: TauriSession,
    peer_ptid: str,
    expected_state: str,
    *,
    timeout: float = STEP_TIMEOUT,
) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        snap = _call_snapshot(client, peer_ptid)
        if isinstance(snap, dict) and snap.get("state") == expected_state:
            return snap
        return None

    result = wait_until(
        check,
        f"call state {expected_state}",
        timeout=timeout,
        interval=0.5,
    )
    if result is None:
        actual = _call_snapshot(client, peer_ptid)
        raise GateError(
            f"call did not reach state={expected_state} within {timeout}s; "
            f"actual={actual}"
        )
    return result


def _detail(value: object) -> str:
    return json.dumps(value, sort_keys=True)


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


def _media_harness(
    client: TauriSession,
    runtime_binding: NativeDesktopRuntimeBinding,
    method: str,
    payload: dict[str, Any],
    *,
    timeout: float = 45.0,
) -> Any:
    if client.process_id is None:
        raise GateError(f"{method} has no owning Native process")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            async_harness,
            client,
            method,
            payload,
            timeout,
        )
        while True:
            try:
                return future.result(timeout=0.1)
            except FutureTimeoutError:
                try:
                    runtime_binding.native_adapter.accept_media_capture_permission_to_process(
                        client.process_id
                    )
                except DriverError as permission_error:
                    try:
                        return future.result(timeout=2)
                    except FutureTimeoutError:
                        raise permission_error


def _call_surface(client: TauriSession) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const surface = document.querySelector('[data-chat-call-surface]');
        if (!surface) return null;
        const rect = (element) => {
          if (!element) return null;
          const value = element.getBoundingClientRect();
          return {
            left: value.left,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          };
        };
        const media = (selector) => {
          const element = surface.querySelector(selector);
          const stream = element?.srcObject;
          return element ? {
            hasStream: stream instanceof MediaStream,
            readyState: Number(element.readyState || 0),
            videoWidth: Number(element.videoWidth || 0),
            videoHeight: Number(element.videoHeight || 0),
            liveTracks: stream instanceof MediaStream
              ? stream.getTracks().filter((track) => track.readyState === 'live').map((track) => track.kind)
              : [],
          } : null;
        };
        return {
          state: surface.getAttribute('data-chat-call-state') || '',
          mediaKind: surface.getAttribute('data-chat-call-media-kind') || '',
          displayMode: surface.getAttribute('data-chat-call-display-mode') || '',
          surfaceRect: rect(surface),
          chatRect: rect(document.querySelector('[data-social-chat-layout]')),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          localVideo: media('[data-chat-call-local-video]'),
          remoteVideo: media('[data-chat-call-remote-video]'),
          remoteAudio: media('[data-chat-call-remote-audio]'),
        };
        """
    )
    return value if isinstance(value, dict) else None


def _set_call_display_mode(
    client: TauriSession,
    expected_mode: str,
) -> dict[str, Any]:
    clicked = client.execute_script(
        """
        const mode = arguments[0];
        const button = document.querySelector(
          `[data-chat-call-display-mode-target="${mode}"]`,
        );
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
        """,
        expected_mode,
    )
    if clicked is not True:
        raise GateError(f"call display control is unavailable: {expected_mode}")

    result = wait_until(
        lambda: (
            surface
            if (
                (surface := _call_surface(client))
                and surface.get("displayMode") == expected_mode
            )
            else None
        ),
        f"call display mode {expected_mode}",
        timeout=5,
        interval=0.1,
    )
    if not isinstance(result, dict):
        raise GateError(f"call display mode did not settle: {expected_mode}")
    return result


def _rects_match(
    left: object,
    right: object,
    *,
    tolerance: float = 2.0,
) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    return all(
        abs(float(left.get(field, -10_000)) - float(right.get(field, 10_000)))
        <= tolerance
        for field in ("left", "top", "width", "height")
    )


class LifecycleLiveVoiceGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "CHAT-W05"
    bom = ("CHAT-G06", "CHAT-UR07")
    spec = ("CHAT-J05", "chat-live-voice-lifecycle")
    report_path = REPORT_PATH

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=GATE_ID,
        )
        self.conversation_id = ""

    def open_conversation(self) -> str:
        self.conversation_id = super().open_conversation()
        return self.conversation_id

    def _prove_audio_call_lifecycle(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {}

        alice = self.clients["alice"]
        bob = self.clients["bob"]
        alice_ptid = self.ptids["alice"]
        bob_ptid = self.ptids["bob"]

        _media_harness(alice, self.runtime_binding, "callStart", {
            "peerPtid": bob_ptid,
            "mediaKind": "audio",
        })

        outgoing = _wait_call_state(alice, bob_ptid, "outgoing", timeout=30)
        self.assert_condition(
            "call_audio_outgoing_ring",
            outgoing.get("mediaKind") == "audio",
            detail=_detail(outgoing),
        )

        incoming = _wait_call_state(bob, alice_ptid, "incoming", timeout=30)
        self.assert_condition(
            "call_audio_callee_incoming",
            incoming.get("mediaKind") == "audio",
            detail=_detail(incoming),
        )

        _media_harness(
            bob,
            self.runtime_binding,
            "callAccept",
            {"peerPtid": alice_ptid},
        )

        alice_active = _wait_call_state(alice, bob_ptid, "active", timeout=30)
        bob_active = _wait_call_state(bob, alice_ptid, "active", timeout=30)
        self.assert_condition(
            "call_audio_accept_active",
            alice_active.get("state") == "active"
            and bob_active.get("state") == "active",
            detail=_detail({
                "alice": alice_active,
                "bob": bob_active,
            }),
        )

        audio_media = wait_until(
            lambda: (
                {"alice": alice_snapshot, "bob": bob_snapshot}
                if (
                    (alice_snapshot := _call_snapshot(alice, bob_ptid))
                    and (bob_snapshot := _call_snapshot(bob, alice_ptid))
                    and _has_live_track(alice_snapshot, "audio", "local")
                    and _has_live_track(alice_snapshot, "audio", "remote")
                    and _has_live_track(bob_snapshot, "audio", "local")
                    and _has_live_track(bob_snapshot, "audio", "remote")
                )
                else None
            ),
            "bilateral live audio tracks",
            timeout=30,
            interval=0.5,
        )
        self.assert_condition(
            "call_audio_receiver_media_live",
            bool(audio_media),
            detail=_detail(audio_media),
        )

        async_harness(alice, "callEnd", {"peerPtid": bob_ptid})

        alice_ended = _wait_call_state(alice, bob_ptid, "ended", timeout=15)
        bob_ended = _wait_call_state(bob, alice_ptid, "ended", timeout=15)
        self.assert_condition(
            "call_audio_hangup_ended",
            alice_ended.get("endReason") == "hangup"
            and bob_ended.get("endReason") == "hangup",
            detail=_detail({
                "alice": alice_ended,
                "bob": bob_ended,
            }),
        )
        evidence["audioLifecycle"] = {
            "outgoing": outgoing,
            "incoming": incoming,
            "aliceActive": alice_active,
            "bobActive": bob_active,
            "media": audio_media,
            "aliceEnded": alice_ended,
            "bobEnded": bob_ended,
        }
        return evidence

    def _prove_audio_reject(self) -> dict[str, Any]:
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        bob_ptid = self.ptids["bob"]
        alice_ptid = self.ptids["alice"]

        _media_harness(alice, self.runtime_binding, "callStart", {
            "peerPtid": bob_ptid,
            "mediaKind": "audio",
        })
        _wait_call_state(alice, bob_ptid, "outgoing", timeout=15)
        _wait_call_state(bob, alice_ptid, "incoming", timeout=15)

        async_harness(bob, "callReject", {"peerPtid": alice_ptid})

        alice_ended = _wait_call_state(alice, bob_ptid, "ended", timeout=15)
        bob_ended = _wait_call_state(bob, alice_ptid, "ended", timeout=15)
        self.assert_condition(
            "call_audio_reject",
            alice_ended.get("endReason") == "rejected",
            detail=_detail({"alice": alice_ended, "bob": bob_ended}),
        )
        return {"reject": {"alice": alice_ended, "bob": bob_ended}}

    def _prove_audio_no_answer(self) -> dict[str, Any]:
        alice = self.clients["alice"]
        bob_ptid = self.ptids["bob"]

        _media_harness(alice, self.runtime_binding, "callStart", {
            "peerPtid": bob_ptid,
            "mediaKind": "audio",
        })
        _wait_call_state(alice, bob_ptid, "outgoing", timeout=15)

        ended = _wait_call_state(alice, bob_ptid, "ended", timeout=RING_TIMEOUT)
        self.assert_condition(
            "call_audio_no_answer",
            ended.get("endReason") == "no-answer",
            detail=_detail(ended),
        )
        return {"noAnswer": ended}

    def _prove_video_call_lifecycle(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {}

        alice = self.clients["alice"]
        bob = self.clients["bob"]
        alice_ptid = self.ptids["alice"]
        bob_ptid = self.ptids["bob"]

        _media_harness(alice, self.runtime_binding, "callStart", {
            "peerPtid": bob_ptid,
            "mediaKind": "video",
        })

        outgoing = _wait_call_state(alice, bob_ptid, "outgoing", timeout=30)
        self.assert_condition(
            "call_video_outgoing_ring",
            outgoing.get("mediaKind") == "video",
            detail=_detail(outgoing),
        )

        _wait_call_state(bob, alice_ptid, "incoming", timeout=30)
        _media_harness(
            bob,
            self.runtime_binding,
            "callAccept",
            {"peerPtid": alice_ptid},
        )

        alice_active = _wait_call_state(alice, bob_ptid, "active", timeout=30)
        bob_active = _wait_call_state(bob, alice_ptid, "active", timeout=30)
        self.assert_condition(
            "call_video_accept_active",
            alice_active.get("state") == "active"
            and bob_active.get("state") == "active",
            detail=_detail({"alice": alice_active, "bob": bob_active}),
        )

        video_media = wait_until(
            lambda: (
                {
                    "alice": alice_snapshot,
                    "bob": bob_snapshot,
                    "aliceSurface": alice_surface,
                    "bobSurface": bob_surface,
                }
                if (
                    (alice_snapshot := _call_snapshot(alice, bob_ptid))
                    and (bob_snapshot := _call_snapshot(bob, alice_ptid))
                    and (alice_surface := _call_surface(alice))
                    and (bob_surface := _call_surface(bob))
                    and _has_live_track(alice_snapshot, "video", "local")
                    and _has_live_track(alice_snapshot, "video", "remote")
                    and _has_live_track(bob_snapshot, "video", "local")
                    and _has_live_track(bob_snapshot, "video", "remote")
                )
                else None
            ),
            "bilateral live video tracks and surfaces",
            timeout=30,
            interval=0.5,
        )
        alice_surface = (video_media or {}).get("aliceSurface")
        bob_surface = (video_media or {}).get("bobSurface")
        self.assert_condition(
            "call_video_local_preview_live",
            isinstance(alice_surface, dict)
            and isinstance(alice_surface.get("localVideo"), dict)
            and alice_surface["localVideo"].get("hasStream") is True
            and "video" in alice_surface["localVideo"].get("liveTracks", []),
            detail=_detail(alice_surface),
        )
        self.assert_condition(
            "call_video_receiver_media_live",
            isinstance(bob_surface, dict)
            and isinstance(bob_surface.get("remoteVideo"), dict)
            and bob_surface["remoteVideo"].get("hasStream") is True
            and "video" in bob_surface["remoteVideo"].get("liveTracks", [])
            and _has_live_track((video_media or {}).get("bob"), "audio", "remote"),
            detail=_detail(bob_surface),
        )

        compact_layout = _set_call_display_mode(alice, "compact")
        compact_rect = compact_layout.get("surfaceRect")
        compact_viewport = compact_layout.get("viewport")
        compact_ok = (
            isinstance(compact_rect, dict)
            and isinstance(compact_viewport, dict)
            and 240 <= float(compact_rect.get("width", 0)) <= 320
            and abs(
                float(compact_viewport.get("width", 0))
                - float(compact_rect.get("right", 0))
                - 20
            ) <= 2
            and abs(
                float(compact_viewport.get("height", 0))
                - float(compact_rect.get("bottom", 0))
                - 20
            ) <= 2
        )
        self.assert_condition(
            "call_video_compact_layout",
            compact_ok,
            detail=_detail(compact_layout),
        )

        chat_layout = _set_call_display_mode(alice, "chat")
        self.assert_condition(
            "call_video_chat_fill_layout",
            _rects_match(
                chat_layout.get("surfaceRect"),
                chat_layout.get("chatRect"),
            ),
            detail=_detail(chat_layout),
        )

        fullscreen_layout = _set_call_display_mode(alice, "fullscreen")
        fullscreen_rect = fullscreen_layout.get("surfaceRect")
        fullscreen_viewport = fullscreen_layout.get("viewport")
        fullscreen_ok = (
            isinstance(fullscreen_rect, dict)
            and isinstance(fullscreen_viewport, dict)
            and abs(float(fullscreen_rect.get("left", -1))) <= 2
            and abs(float(fullscreen_rect.get("top", -1))) <= 2
            and abs(
                float(fullscreen_rect.get("width", 0))
                - float(fullscreen_viewport.get("width", -1))
            ) <= 2
            and abs(
                float(fullscreen_rect.get("height", 0))
                - float(fullscreen_viewport.get("height", -1))
            ) <= 2
        )
        self.assert_condition(
            "call_video_fullscreen_layout",
            fullscreen_ok,
            detail=_detail(fullscreen_layout),
        )
        _set_call_display_mode(alice, "compact")

        mic_result = async_harness(alice, "callToggleMic", {
            "peerPtid": bob_ptid,
            "muted": True,
        })
        mic_snap = (
            mic_result.get("snapshot")
            if isinstance(mic_result, dict) else None
        )
        self.assert_condition(
            "call_video_toggle_mic",
            isinstance(mic_snap, dict) and mic_snap.get("micMuted") is True,
            detail=_detail(mic_snap),
        )

        cam_result = async_harness(alice, "callToggleCamera", {
            "peerPtid": bob_ptid,
            "off": True,
        })
        cam_snap = (
            cam_result.get("snapshot")
            if isinstance(cam_result, dict) else None
        )
        self.assert_condition(
            "call_video_toggle_camera",
            isinstance(cam_snap, dict) and cam_snap.get("cameraOff") is True,
            detail=_detail(cam_snap),
        )
        async_harness(alice, "callToggleCamera", {
            "peerPtid": bob_ptid,
            "off": False,
        })

        device_switch = async_harness(
            alice,
            "callSwitchVideoDevice",
            {"peerPtid": bob_ptid},
        )
        switched_receiver = wait_until(
            lambda: (
                snapshot
                if (
                    (snapshot := _call_snapshot(bob, alice_ptid))
                    and _has_live_track(snapshot, "video", "remote")
                )
                else None
            ),
            "receiver video after camera device switch",
            timeout=30,
            interval=0.5,
        )
        self.assert_condition(
            "call_video_device_switch",
            isinstance(device_switch, dict)
            and device_switch.get("available") is True
            and device_switch.get("switched") is True
            and device_switch.get("newTrackLive") is True
            and bool(switched_receiver),
            detail=_detail({
                "sender": device_switch,
                "receiver": switched_receiver,
            }),
        )

        reconnect_actor = "alice" if alice_ptid < bob_ptid else "bob"
        reconnect_client = self.clients[reconnect_actor]
        reconnect_peer = (
            bob_ptid if reconnect_actor == "alice" else alice_ptid
        )
        reconnecting = async_harness(
            reconnect_client,
            "callRestartConnection",
            {"peerPtid": reconnect_peer},
        )
        reconnecting_snapshot = (
            reconnecting.get("snapshot")
            if isinstance(reconnecting, dict)
            else None
        )
        self.assert_condition(
            "call_reconnect_entered",
            isinstance(reconnecting_snapshot, dict)
            and reconnecting_snapshot.get("state") == "reconnecting",
            detail=_detail(reconnecting_snapshot),
        )
        recovered = _wait_call_state(
            reconnect_client,
            reconnect_peer,
            "active",
            timeout=30,
        )
        self.assert_condition(
            "call_reconnect_recovered",
            _has_live_track(recovered, "audio", "local")
            and _has_live_track(recovered, "video", "local"),
            detail=_detail(recovered),
        )

        async_harness(alice, "callEnd", {"peerPtid": bob_ptid})

        alice_ended = _wait_call_state(alice, bob_ptid, "ended", timeout=15)
        bob_ended = _wait_call_state(bob, alice_ptid, "ended", timeout=15)
        self.assert_condition(
            "call_video_hangup_ended",
            alice_ended.get("endReason") == "hangup",
            detail=_detail({"alice": alice_ended, "bob": bob_ended}),
        )

        evidence["videoLifecycle"] = {
            "outgoing": outgoing,
            "aliceActive": alice_active,
            "bobActive": bob_active,
            "media": video_media,
            "displayModes": {
                "compact": compact_layout,
                "chat": chat_layout,
                "fullscreen": fullscreen_layout,
            },
            "micToggle": mic_snap,
            "cameraToggle": cam_snap,
            "deviceSwitch": {
                "sender": device_switch,
                "receiver": switched_receiver,
            },
            "reconnecting": reconnecting_snapshot,
            "recovered": recovered,
            "aliceEnded": alice_ended,
            "bobEnded": bob_ended,
        }
        return evidence

    def _prove_text_usable_during_call(self) -> dict[str, Any]:
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        alice_ptid = self.ptids["alice"]
        bob_ptid = self.ptids["bob"]

        _media_harness(alice, self.runtime_binding, "callStart", {
            "peerPtid": bob_ptid,
            "mediaKind": "audio",
        })
        _wait_call_state(alice, bob_ptid, "outgoing", timeout=15)
        _wait_call_state(bob, alice_ptid, "incoming", timeout=15)
        _media_harness(
            bob,
            self.runtime_binding,
            "callAccept",
            {"peerPtid": alice_ptid},
        )
        _wait_call_state(alice, bob_ptid, "active", timeout=15)

        text = f"call-text-probe-{time.time_ns()}"
        sent = send_text(alice, text)
        received = wait_until(
            lambda: message_snapshot(bob, text),
            "receiver text while call active",
            timeout=30,
            interval=0.5,
        )

        async_harness(alice, "callEnd", {"peerPtid": bob_ptid})
        _wait_call_state(alice, bob_ptid, "ended", timeout=15)
        _wait_call_state(bob, alice_ptid, "ended", timeout=15)

        sent_ok = isinstance(sent, dict) and bool(sent.get("messageUlid"))
        received_ok = (
            isinstance(received, dict)
            and received.get("messageUlid") == sent.get("messageUlid")
            and text in str(received.get("text") or "")
        )
        self.assert_condition(
            "text_usable_during_call",
            sent_ok and received_ok,
            detail=_detail({"sent": sent, "received": received}),
        )
        return {"textDuringCall": {"sent": sent, "received": received}}

    def _prove_resources_released(self) -> dict[str, Any]:
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        alice_ptid = self.ptids["alice"]
        bob_ptid = self.ptids["bob"]

        alice_snapshot = _call_snapshot(alice, bob_ptid)
        bob_snapshot = _call_snapshot(bob, alice_ptid)
        released = (
            isinstance(alice_snapshot, dict)
            and alice_snapshot.get("state") == "ended"
            and not alice_snapshot.get("localTracks")
            and not alice_snapshot.get("remoteTracks")
            and isinstance(bob_snapshot, dict)
            and bob_snapshot.get("state") == "ended"
            and not bob_snapshot.get("localTracks")
            and not bob_snapshot.get("remoteTracks")
        )
        self.assert_condition(
            "call_resources_released",
            released,
            detail=_detail({"alice": alice_snapshot, "bob": bob_snapshot}),
        )
        return {
            "resourcesReleased": {
                "alice": alice_snapshot,
                "bob": bob_snapshot,
            },
        }

    def prove_additional_journey_assertions(self) -> None:
        if not self.conversation_id:
            raise GateError("live voice journey has no Direct conversation")
        audio_evidence = self.step(
            "call.audio.lifecycle",
            self._prove_audio_call_lifecycle,
        )
        reject_evidence = self.step(
            "call.audio.reject",
            self._prove_audio_reject,
        )
        no_answer_evidence = self.step(
            "call.audio.no-answer",
            self._prove_audio_no_answer,
        )
        video_evidence = self.step(
            "call.video.lifecycle",
            self._prove_video_call_lifecycle,
        )
        text_evidence = self.step(
            "call.text-during-active",
            self._prove_text_usable_during_call,
        )
        release_evidence = self.step(
            "call.resources-released",
            self._prove_resources_released,
        )
        self.report.runtime["liveVoice"] = {
            **audio_evidence,
            **reject_evidence,
            **no_answer_evidence,
            **video_evidence,
            **text_evidence,
            **release_evidence,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {
            assertion.name
            for assertion in self.report.assertions
        }
        missing = REQUIRED_LIVE_VOICE_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"live voice assertions are missing: {sorted(missing)}"
            )
        result["journey"] = "chat-live-voice-lifecycle"
        self.report.runtime["journey"] = "chat-live-voice-lifecycle"
        return result


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = LifecycleLiveVoiceGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
