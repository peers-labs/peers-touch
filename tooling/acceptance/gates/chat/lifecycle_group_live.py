#!/usr/bin/env python3
"""Prove group media and permission withdrawal on native Desktop and Mobile."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import dataclasses
import time
from typing import Any
from urllib.parse import urlsplit

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.gates.chat.mixed_native_runtime import MixedNativeRuntime
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
    verify_runtime_fixture_ready,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    restart_acceptance_group_sfu,
    restart_acceptance_station,
)

GATE_ID = "chat-lifecycle-group-live-e2e"
ACTORS = ("alice", "bob", "charlie")
CLIENTS = {"alice": "desktop-alice", "bob": "desktop-bob", "charlie": "sim-ios-peer"}
DESKTOP_RUNTIME_IDENTITY = "desktop-macos-native"
STEP_TIMEOUT = 120.0
REQUIRED_ASSERTIONS = {
    "group_call_native_runtime", "group_call_actor_isolation",
    "group_call_room_converged", "group_call_audio_media_live",
    "group_call_mute_converged", "group_call_audio_released",
    "group_call_video_media_live", "group_call_camera_converged",
    "group_call_late_join_converged", "group_call_video_released",
    "group_call_member_removal_ejected", "group_call_restart_converged",
    "group_call_session_revocation_ejected", "group_call_device_revocation_ejected",
    "group_call_revoked_token_replay_denied",
    "group_call_signal_reconnect_converged",
    "group_call_refreshed_token_replay_denied",
    "group_call_authority_restart_replay_denied",
    "group_call_sfu_restart_replay_denied",
    "group_call_sfu_restart_media_recovered",
    "group_call_member_token_replay_denied",
    "group_call_session_token_replay_denied",
}


def _rtp_delta(before: dict[str, Any], after: dict[str, Any], *,
               actor_ptid: str, peer_ptids: set[str], video: bool) -> dict[str, Any] | None:
    """Require media progress on every sender/receiver edge, in one RTC session."""
    if not all(
        item.get("connected") is True and item.get("canPublish") is True
        and item.get("canSubscribe") is True and item.get("roomSid")
        and item.get("participantSid") for item in (before, after)
    ) or before["roomSid"] != after["roomSid"] or before["participantSid"] != after["participantSid"]:
        return None
    def key(row: dict[str, Any]) -> tuple[str, ...]:
        return tuple(str(row.get(field) or "") for field in ("actorPtid", "trackSid", "kind", "direction"))
    old = {key(row): row for row in before.get("tracks", []) if isinstance(row, dict)}
    deltas = []
    for row in after.get("tracks", []):
        if not isinstance(row, dict) or key(row) not in old:
            continue
        previous = old[key(row)]
        delta = {field: int(row.get(field) or 0) - int(previous.get(field) or 0)
                 for field in ("bytes", "packets", "frames")}
        if delta["bytes"] > 0 and delta["packets"] > 0 and (
            row.get("kind") != "video" or delta["frames"] > 0
        ):
            deltas.append({**dict(zip(("actorPtid", "trackSid", "kind", "direction"), key(row))), **delta})
    kinds = {"audio", "video"} if video else {"audio"}
    for direction, actors in (("outbound", {actor_ptid}), ("inbound", peer_ptids)):
        if not all(any(row["direction"] == direction and row["actorPtid"] == actor
                       and row["kind"] == kind for row in deltas)
                   for actor in actors for kind in kinds):
            return None
    return {"roomSid": after["roomSid"], "participantSid": after["participantSid"], "deltas": deltas}


class LifecycleGroupLiveGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "CHAT-W05B"
    bom = ("CHAT-G06", "CHAT-UR09")
    spec = ("CHAT-J09", "chat-group-live-lifecycle")
    report_path = None

    def __init__(self, *, runtime: MixedNativeRuntime | None = None) -> None:
        super().__init__()
        self.runtime = runtime or MixedNativeRuntime.from_environment(GATE_ID)
        self.runtime_binding = self.runtime.desktop_binding
        self.report.manifest = self.runtime.manifest
        self.report.station_url = str(self.runtime.manifest["services"]["station-primary"]["endpoint"])
        self.steps: list[dict[str, Any]] = []
        self.report.runtime.update({
            "runtimeCell": "desktop-macos-native+ios-simulator",
            "journey": "chat-group-live-lifecycle", "steps": self.steps, "cleanup": {},
        })

    def step(self, name: str, action: Any, actor: str = "") -> Any:
        started = time.monotonic()
        record = {"step": name, "client": actor, "status": "pass"}
        try:
            return action()
        except Exception as error:
            record.update(status="fail", error=str(error))
            raise
        finally:
            record["durationMs"] = int((time.monotonic() - started) * 1000)
            self.steps.append(record)

    def action(self, actor: str, name: str, payload: dict[str, Any] | None = None) -> Any:
        return self.runtime.call_action(CLIENTS[actor], name, payload or {}, timeout=45)

    def snapshot(self, actor: str) -> dict[str, Any]:
        result = self.action(actor, "groupCallSnapshot")
        if not isinstance(result, dict) or not isinstance(result.get("snapshot"), dict):
            raise GateError(f"{actor} has no group-call snapshot")
        return result["snapshot"]

    def media(self, actor: str) -> dict[str, Any]:
        result = self.action(actor, "groupCallMediaStats")
        if not isinstance(result, dict) or not isinstance(result.get("media"), dict):
            raise GateError(f"{actor} has no SDK media observation")
        return result["media"]

    def sfu_service(self, sfu_url: str) -> dict[str, Any]:
        host = urlsplit(sfu_url).hostname
        services = [
            service for service in self.runtime.manifest["services"].values()
            if isinstance(service, dict) and service.get("kind") == "station"
            and host and urlsplit(str(service.get("endpoint") or "")).hostname == host
        ]
        if len(services) != 1:
            raise GateError("Actual group SFU must belong to exactly one bound Station host")
        return services[0]

    def connected(self, actors: tuple[str, ...] = ACTORS) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            values = {actor: self.snapshot(actor) for actor in actors}
            expected = {self.runtime.identities[CLIENTS[actor]].ptid for actor in actors}
            if all(value.get("state") == "connected"
                   and len(value.get("participants", [])) == len(actors)
                   and {p.get("actorPtid") for p in value.get("participants", [])} == expected
                   for value in values.values()):
                return values
            return None
        return self.runtime.wait_until(read, "native group roster", timeout_seconds=STEP_TIMEOUT)

    def click(self, actor: str, selector: str) -> None:
        session = self.runtime.desktop_session(CLIENTS[actor])
        def activate() -> None:
            if session is not None:
                session.find_element(selector, timeout=30).click()
            else:
                value = self.runtime._required_mobile_binding().semantic_click(CLIENTS[actor], selector)
                if value.get("activated") is not True:
                    raise GateError(f"{actor} could not activate {selector}")
        self.step("ui.action", activate, actor)
        self.steps[-1]["selector"] = selector

    def control(self, actor: str, name: str) -> None:
        selector = (f'[data-group-call-control="{name}"]'
                    if self.runtime.desktop_session(CLIENTS[actor]) is not None
                    else f'[data-action-id="group-call.{name}"]')
        self.click(actor, selector)

    def join(self, actor: str, group_id: str, kind: str) -> None:
        client_id = CLIENTS[actor]
        session = self.runtime.desktop_session(client_id)
        if session is None:
            self.action(actor, "navigation.apply", {
                "kind": "detail.push", "route": {"routeId": "detail:group-conversation", "groupUlid": group_id},
            })
            # Use the actual Mobile header button; no fixture or simulated join.
            self.click(actor, f'[data-group-call-start="{kind}"]')
            return
        # Native capture permissions must be handled while the SDK awaits them.
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.action, actor, "groupCallStart", {
                "groupUlid": group_id, "mediaKind": kind,
            })
            while True:
                try:
                    future.result(timeout=0.1)
                    break
                except FutureTimeoutError:
                    if session.process_id is None:
                        raise GateError("Desktop group capture has no owning process")
                    self.runtime.desktop_binding.native_adapter.accept_media_capture_permission_to_process(session.process_id)

    def join_all(self, group_id: str, kind: str) -> dict[str, Any]:
        for actor in ACTORS:
            self.join(actor, group_id, kind)
        return self.connected()

    def live_media(self, *, video: bool, actors: tuple[str, ...] = ACTORS) -> dict[str, Any]:
        before = {actor: self.media(actor) for actor in actors}
        def read() -> dict[str, Any] | None:
            result = {}
            for actor in actors:
                observation = self.media(actor)
                ptid = self.runtime.identities[CLIENTS[actor]].ptid
                delta = _rtp_delta(before[actor], observation, actor_ptid=ptid,
                    peer_ptids={self.runtime.identities[CLIENTS[other]].ptid for other in actors if other != actor},
                    video=video)
                if delta is None:
                    # Newly subscribed tracks need their first baseline.
                    if observation.get("participantSid") == before[actor].get("participantSid"):
                        known = {row.get("trackSid") for row in before[actor].get("tracks", [])}
                        before[actor]["tracks"].extend(row for row in observation.get("tracks", [])
                                                     if row.get("trackSid") not in known)
                    return None
                result[actor] = delta
            return result
        result = self.runtime.wait_until(read, "all native RTP edges progress", timeout_seconds=STEP_TIMEOUT)
        # Media proof also requires the production receiver surface.
        for actor in actors:
            selector = '[data-group-call-surface][data-group-call-state="connected"]'
            session = self.runtime.desktop_session(CLIENTS[actor])
            if session is not None:
                surface = session.find_element(selector)
                if video and surface.get_attribute("data-group-call-display-mode") == "compact":
                    self.click(actor, '[data-group-call-display-mode-target="expanded"]')
            else:
                value = self.runtime._required_mobile_binding().semantic_observe(CLIENTS[actor], selector)
                if value.get("matched") is not True:
                    raise GateError("Mobile live media surface is absent")
            self.capture(actor, "video" if video else "audio")
        return result

    def capture(self, actor: str, phase: str) -> None:
        session = self.runtime.desktop_session(CLIENTS[actor])
        if session is not None:
            self.save_screenshot(session, f"{actor}-{phase}")
            self.save_dom(session, f"{actor}-{phase}")
        else:
            binding = self.runtime._required_mobile_binding()
            captures = self.report.runtime.setdefault("mobileCaptures", [])
            captures.append({
                "actor": actor, "phase": phase,
                "screenshot": binding.capture_screenshot(CLIENTS[actor], phase).to_dict(),
                "dom": binding.capture_web_dom(CLIENTS[actor], phase).to_dict(),
            })

    def participant_state(self, actor: str, field: str, expected: bool) -> dict[str, Any]:
        ptid = self.runtime.identities[CLIENTS[actor]].ptid
        def read() -> dict[str, Any] | None:
            values = self.connected()
            return values if all(any(p.get("actorPtid") == ptid and p.get(field) is expected
                                     for p in value["participants"]) for value in values.values()) else None
        return self.runtime.wait_until(read, f"{actor} {field} converges", timeout_seconds=STEP_TIMEOUT)

    def released(self, actor: str) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            snapshot, media = self.snapshot(actor), self.media(actor)
            if snapshot.get("state") in {"idle", "failed"} and not media.get("connected") \
                    and media.get("localLiveTracks") == 0 and not media.get("tracks"):
                return {"state": snapshot["state"], "media": media}
            return None
        return self.runtime.wait_until(read, f"{actor} media released", timeout_seconds=STEP_TIMEOUT)

    def leave_all(self) -> dict[str, Any]:
        for actor in ACTORS:
            self.control(actor, "leave")
        return {actor: self.released(actor) for actor in ACTORS}

    def ejected(self, actor: str, remaining: tuple[str, ...]) -> dict[str, Any]:
        return {"released": self.released(actor), "remaining": self.connected(remaining)}

    def cleanup(self) -> dict[str, Any]:
        errors: list[str] = []
        for actor in ("alice", "bob"):
            if self.runtime.desktop_session(CLIENTS[actor]) is not None:
                try:
                    self.action(actor, "groupCallProbeClear")
                except Exception:
                    errors.append(f"{actor}: group-call probe cleanup failed")
        result = self.runtime.cleanup(save_desktop_log=self.save_app_log)
        result.setdefault("cleanupErrors", []).extend(errors)
        return result

    def run(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {}
        self.report.runtime["groupLive"] = evidence
        try:
            self.step("fixture.reset", lambda: verify_runtime_fixture_ready(
                self.runtime.manifest, self.runtime.actor_manifest))
            for index, actor in enumerate(ACTORS):
                self.step("client.authenticated", lambda actor=actor, index=index:
                    self.runtime.start_client(CLIENTS[actor], window_slot=index, window_count=3), actor)
                self.report.add_actor(dataclasses.replace(self.runtime.actor_runtime(CLIENTS[actor]), name=actor))
            identities = {actor: self.runtime.identities[CLIENTS[actor]] for actor in ACTORS}
            source = self.step("station.identity", self.runtime.source_identity)
            self.report.runtime["sourceIdentity"] = source
            source["mobileBinary"] = self.action("charlie", "build.identity")
            self.report.runtime["mobileBindingProofRefs"] = self.runtime.access_evidence[
                CLIENTS["charlie"]]["bindingProofRefs"]
            self.assert_condition("group_call_native_runtime",
                identities["charlie"].runtime == "tauri-ios-simulator"
                and all(identities[actor].runtime == DESKTOP_RUNTIME_IDENTITY for actor in ("alice", "bob")))
            self.assert_condition("group_call_actor_isolation", len({value.ptid for value in identities.values()}) == 3)
            if len({value.federation_id for value in identities.values()}) != 1:
                raise GateError("Group participants do not share a Federation")
            group_id = self.step("group.create", lambda: self.runtime.create_group(
                CLIENTS["alice"], (CLIENTS["bob"], CLIENTS["charlie"]),
                federation_id=identities["alice"].federation_id,
                name=f"Group Live {time.time_ns()}", timeout_seconds=STEP_TIMEOUT))
            evidence["groupId"] = group_id
            evidence["clients"] = {actor: {"id": CLIENTS[actor], "runtime": value.runtime,
                "ptid": value.ptid, "stationServiceId": value.station_service_id} for actor, value in identities.items()}
            audio = self.step("group-call.audio.join", lambda: self.join_all(group_id, "audio"))
            evidence["audio"] = audio
            self.assert_condition("group_call_room_converged",
                len({value["roomName"] for value in audio.values()}) == 1)
            evidence["audioMedia"] = self.step("group-call.audio.media", lambda: self.live_media(video=False))
            self.assert_condition("group_call_audio_media_live", True)
            self.control("charlie", "microphone")
            evidence["mute"] = self.participant_state("charlie", "isMicEnabled", False)
            self.assert_condition("group_call_mute_converged", True)
            evidence["audioReleased"] = self.leave_all()
            self.assert_condition("group_call_audio_released", True)

            for actor in ("alice", "bob"):
                self.action(actor, "groupCallProbeArm")
            evidence["video"] = self.step("group-call.video.join", lambda: self.join_all(group_id, "video"))
            evidence["videoMedia"] = self.step("group-call.video.media", lambda: self.live_media(video=True))
            self.assert_condition("group_call_video_media_live", True)
            before_reconnect = {actor: self.media(actor) for actor in ACTORS}
            evidence["signalReconnect"] = self.step("group-call.signal-reconnect",
                lambda: self.action("bob", "groupCallSignalReconnect"))
            evidence["reconnected"] = self.connected()
            evidence["reconnectMedia"] = self.live_media(video=True)
            self.assert_condition("group_call_signal_reconnect_converged",
                evidence["signalReconnect"].get("observedReconnecting") is True
                and all(before_reconnect[actor]["participantSid"] ==
                        evidence["reconnectMedia"][actor]["participantSid"] for actor in ACTORS))
            for actor in ("alice", "bob"):
                self.runtime.wait_until(
                    lambda actor=actor: self.action(actor, "groupCallProbeStatus").get("hasRefreshedToken") is True,
                    f"{actor} SFU-generated refreshed JWT", timeout_seconds=STEP_TIMEOUT)
            self.control("charlie", "camera")
            evidence["cameraOff"] = self.participant_state("charlie", "isCameraEnabled", False)
            self.assert_condition("group_call_camera_converged", True)
            self.control("charlie", "leave")
            self.released("charlie")
            self.connected(("alice", "bob"))
            self.join("charlie", group_id, "video")
            evidence["lateJoin"] = self.connected()
            self.assert_condition("group_call_late_join_converged", True)

            member_sid = self.media("bob")["participantSid"]
            self.runtime.remove_group_member(CLIENTS["alice"], group_id, identities["bob"].ptid)
            evidence["memberRemoval"] = self.step("group-call.member-removal",
                lambda: self.ejected("bob", ("alice", "charlie")))
            self.assert_condition("group_call_member_removal_ejected", True)
            for phase, token_kind in (("memberReplay", "initial"), ("memberRefreshedReplay", "refreshed")):
                evidence[phase] = self.step(f"group-call.{phase}", lambda token_kind=token_kind:
                    self.action("bob", "groupCallReplayProbe", {
                        "previousSid": member_sid, "tokenKind": token_kind, "consume": False}))
            self.assert_condition("group_call_member_token_replay_denied",
                all(evidence[phase].get("denied") is True for phase in ("memberReplay", "memberRefreshedReplay")))
            self.runtime.add_group_member(CLIENTS["alice"], group_id, identities["bob"].ptid)
            self.action("bob", "groupCallProbeArm")
            self.join("bob", group_id, "video")
            self.connected()
            self.runtime.wait_until(
                lambda: self.action("bob", "groupCallProbeStatus").get("hasRefreshedToken") is True,
                "new grant SFU-generated refreshed JWT", timeout_seconds=STEP_TIMEOUT)
            self.action("charlie", "groupCallLeave")
            self.runtime.restart_client(CLIENTS["charlie"])
            self.released("charlie")
            self.join("charlie", group_id, "video")
            evidence["restart"] = self.connected()
            evidence["restartMedia"] = self.live_media(video=True)
            self.assert_condition("group_call_restart_converged", True)

            original_sid = self.media("bob")["participantSid"]
            self.runtime.revoke_current_device(CLIENTS["bob"])
            evidence["deviceRevocation"] = self.step("group-call.device-revoke",
                lambda: self.ejected("bob", ("alice", "charlie")))
            self.assert_condition("group_call_device_revocation_ejected", True)
            evidence["replay"] = self.step("group-call.revoked-token-replay", lambda:
                self.action("bob", "groupCallReplayProbe", {"previousSid": original_sid, "consume": False}))
            self.assert_condition("group_call_revoked_token_replay_denied",
                evidence["replay"].get("denied") is True)
            evidence["refreshedReplay"] = self.step("group-call.refreshed-token-replay", lambda:
                self.action("bob", "groupCallReplayProbe", {
                    "previousSid": original_sid, "tokenKind": "refreshed", "consume": False}))
            self.assert_condition("group_call_refreshed_token_replay_denied",
                evidence["refreshedReplay"].get("denied") is True)
            authority_service = self.runtime.manifest["services"][identities["alice"].station_service_id]
            evidence["authorityRestart"] = self.step("group-call.authority-restart", lambda:
                restart_acceptance_station(authority_service["endpoint"], source["orchestrator"]["commit"]))
            evidence["authorityRestartReplay"] = self.step("group-call.authority-restart-replay", lambda:
                self.action("bob", "groupCallReplayProbe", {
                    "previousSid": original_sid, "tokenKind": "refreshed", "consume": False}))
            self.assert_condition("group_call_authority_restart_replay_denied",
                evidence["authorityRestartReplay"].get("denied") is True)
            sfu_url = self.action("bob", "groupCallProbeStatus").get("url")
            if not isinstance(sfu_url, str) or not sfu_url:
                raise GateError("Actual production grant SFU URL is unavailable")
            sfu_service = self.sfu_service(sfu_url)
            evidence["sfuRestart"] = self.step("group-call.sfu-restart", lambda:
                restart_acceptance_group_sfu(sfu_service, sfu_url))
            evidence["sfuRestartReplay"] = self.step("group-call.sfu-restart-replay", lambda:
                self.action("bob", "groupCallReplayProbe", {
                    "previousSid": original_sid, "tokenKind": "refreshed", "consume": False}))
            self.assert_condition("group_call_sfu_restart_replay_denied",
                evidence["sfuRestartReplay"].get("denied") is True)
            remaining = ("alice", "charlie")
            self.action("alice", "groupCallProbeArm")
            for actor in remaining:
                self.action(actor, "groupCallLeave")
                self.released(actor)
                self.join(actor, group_id, "video")
            evidence["sfuRecovered"] = self.step("group-call.sfu-rejoin",
                lambda: self.connected(remaining))
            evidence["sfuRecoveryMedia"] = self.step("group-call.sfu-recovery-media",
                lambda: self.live_media(video=True, actors=remaining))
            self.assert_condition("group_call_sfu_restart_media_recovered", True)
            self.runtime.wait_until(
                lambda: self.action("alice", "groupCallProbeStatus").get("hasRefreshedToken") is True,
                "recovered Alice SFU-generated refreshed JWT", timeout_seconds=STEP_TIMEOUT)
            # Session logout uses the original owner and its native lifecycle ledger.
            session_sid = self.media("alice")["participantSid"]
            self.action("alice", "sessionLogout")
            self.runtime.mark_desktop_auth_revoked(CLIENTS["alice"])
            evidence["sessionRevocation"] = self.step("group-call.session-revoke",
                lambda: self.ejected("alice", ("charlie",)))
            self.assert_condition("group_call_session_revocation_ejected", True)
            for phase, token_kind in (("sessionReplay", "initial"), ("sessionRefreshedReplay", "refreshed")):
                evidence[phase] = self.step(f"group-call.{phase}", lambda token_kind=token_kind:
                    self.action("alice", "groupCallReplayProbe", {
                        "previousSid": session_sid, "tokenKind": token_kind, "consume": False}))
            self.assert_condition("group_call_session_token_replay_denied",
                all(evidence[phase].get("denied") is True for phase in ("sessionReplay", "sessionRefreshedReplay")))
            self.control("charlie", "leave")
            evidence["videoReleased"] = {actor: self.released(actor) for actor in ACTORS}
            self.assert_condition("group_call_video_released", True)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                self.cleanup,
                self.report, "Native mixed group live")
            self.report.runtime["cleanup"] = cleanup
        if cleanup.get("cleanupErrors"):
            raise GateError("Group native runtime cleanup failed")
        return dict(self.report.runtime)


def main() -> int:
    status = LifecycleGroupLiveGate().execute()
    if status != 0:
        return status
    from tooling.acceptance.gates.chat.lifecycle_group_live_e2e import main as validate
    return validate()


if __name__ == "__main__":
    raise SystemExit(main())
