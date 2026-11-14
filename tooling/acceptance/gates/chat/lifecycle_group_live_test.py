from __future__ import annotations

import json
import copy
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import REPO_ROOT, GateError
from tooling.acceptance.fixtures.chat_native_reset import GROUP_SFU_ADMISSION_CONTRACT, GROUP_SFU_SOURCE_REVISION
from tooling.acceptance.gates.chat import lifecycle_group_live
from tooling.acceptance.gates.chat.lifecycle_group_live import (
    CLIENTS,
    DESKTOP_RUNTIME_IDENTITY,
    GATE_ID,
    REQUIRED_ASSERTIONS,
    _rtp_delta,
)
from tooling.acceptance.gates.chat.lifecycle_group_live_e2e import REQUIRED_STEPS, validate_group_live_report
from tooling.acceptance.gates.mobile.simulator_harness_contract import (
    CHAT_MIXED_NATIVE_GATE_IDS, CHAT_MIXED_NATIVE_CHILD_HARNESS_ACTIONS,
)


class LifecycleGroupLiveContractTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (REPO_ROOT / path).read_text(encoding="utf-8")

    def test_sfu_restart_selects_actual_bound_host_and_rejects_unbound_targets(self) -> None:
        from types import SimpleNamespace
        primary = {"kind": "station", "endpoint": "http://192.0.2.4:18132",
                   "deploymentEnvironment": "primary"}
        secondary = {"kind": "station", "endpoint": "http://192.0.2.5:18132",
                     "deploymentEnvironment": "secondary"}
        gate = object.__new__(lifecycle_group_live.LifecycleGroupLiveGate)
        services = {"station-primary": primary, "station-secondary": secondary}
        gate.runtime = SimpleNamespace(manifest={"services": services})
        self.assertIs(gate.sfu_service("ws://192.0.2.4:7880"), primary)
        self.assertIs(gate.sfu_service("ws://192.0.2.5:7880"), secondary)
        with self.assertRaisesRegex(GateError, "exactly one bound"):
            gate.sfu_service("ws://192.0.2.6:7880")
        services["duplicate"] = dict(primary)
        with self.assertRaisesRegex(GateError, "exactly one bound"):
            gate.sfu_service("ws://192.0.2.4:7880")

    def test_feature_has_complete_chat_contract_trace(self) -> None:
        domain = json.loads(self.source("tooling/acceptance/domains/chat.yaml"))
        capabilities = json.loads(
            self.source("tooling/acceptance/capabilities/chat.yaml")
        )
        feature = json.loads(
            self.source("tooling/acceptance/features/chat-group-live.yaml")
        )
        capability = next(
            item
            for item in capabilities["capabilities"]
            if item["id"] == "chat-group-live"
        )
        self.assertIn("chat-group-live", domain["capabilities"])
        self.assertIn(feature["id"], capability["features"])
        self.assertIn(GATE_ID, feature["required_gates"])
        self.assertIn(GATE_ID, capability["required_gates"])
        self.assertIn(GATE_ID, capability["evidence"]["proven_by"])

    def test_changed_group_call_paths_select_dedicated_gate(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "plan.json"
            subprocess.run(
                (
                    "python3",
                    "tooling/scripts/acceptance-plan.py",
                    "--changed-file",
                    "apps/desktop/src/modules/groupCall/groupCallManager.ts",
                    "--changed-file",
                    "apps/station/app/subserver/groupcall/livekit_adapter.go",
                    "--output",
                    str(output),
                ),
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            plan = json.loads(output.read_text(encoding="utf-8"))
        selected = {gate["id"] for gate in plan["selected_gates"]}
        self.assertIn(GATE_ID, selected)
        self.assertIn("chat-group-live", plan["impacted_features"])

    def test_gate_is_three_client_native_product_evidence(self) -> None:
        gates = json.loads(self.source("tooling/acceptance/gates.yaml"))
        gate = gates["gates"][GATE_ID]
        self.assertEqual(
            gate["argv"],
            ["python3", "-m", "tooling.acceptance.gates.chat.lifecycle_group_live"],
        )
        self.assertEqual(
            gate["environment"],
            "chat-mixed-native",
        )
        environment = json.loads(self.source("tooling/acceptance/environments/chat-mixed-native.yaml"))
        self.assertEqual(set(environment["gate_client_ids"][GATE_ID]), set(CLIENTS.values()))
        self.assertIn(GATE_ID, CHAT_MIXED_NATIVE_GATE_IDS)
        self.assertIn("groupCallMediaStats", CHAT_MIXED_NATIVE_CHILD_HARNESS_ACTIONS)

    def test_validator_declares_group_live_variant_identity(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/lifecycle_group_live.py"
        )
        validator = self.source(
            "tooling/acceptance/gates/chat/lifecycle_group_live_e2e.py"
        )
        self.assertIn('"mobileBindingProofRefs"', runner)
        self.assertIn("validate_mixed_source(report, store)", validator)
        self.assertIn('"chat-group-live-lifecycle"', validator)

    def test_journey_requires_real_media_and_lifecycle_states(self) -> None:
        for assertion in (
            "group_call_room_converged",
            "group_call_audio_media_live",
            "group_call_mute_converged",
            "group_call_video_media_live",
            "group_call_camera_converged",
            "group_call_late_join_converged",
            "group_call_video_released",
        ):
            self.assertIn(assertion, REQUIRED_ASSERTIONS)
        for step in (
            "group-call.audio.join",
            "group-call.video.join",
        ):
            self.assertIn(step, REQUIRED_STEPS)

    def test_livekit_uses_multi_participant_udp_mux_with_tcp_fallback(self) -> None:
        compose = self.source("tooling/docker/compose.yml")
        self.assertIn("tcp_port: 7881", compose)
        self.assertIn("udp_port: 7881", compose)
        self.assertIn('"${LIVEKIT_RTC_PORT:-7881}:7881/tcp"', compose)
        self.assertIn('"${LIVEKIT_RTC_PORT:-7881}:7881/udp"', compose)
        self.assertNotIn("port_range_start:", compose)
        self.assertNotIn("port_range_end:", compose)

    def test_remote_media_state_requires_all_client_projections_to_converge(
        self,
    ) -> None:
        before = {
            "connected": True, "canPublish": True, "canSubscribe": True,
            "roomSid": "RM-group", "participantSid": "PA-alice",
            "tracks": [{"actorPtid": actor, "trackSid": f"TR-{actor}-{kind}",
                        "kind": kind, "direction": "outbound" if actor == "alice" else "inbound",
                        "bytes": 100, "packets": 10, "frames": 2}
                       for actor in ("alice", "bob", "charlie") for kind in ("audio", "video")],
        }
        after = copy.deepcopy(before)
        for row in after["tracks"]:
            row.update(bytes=200, packets=20, frames=4)
        args = {"actor_ptid": "alice", "peer_ptids": {"bob", "charlie"}, "video": True}
        self.assertEqual(len(_rtp_delta(before, after, **args)["deltas"]), 6)
        self.assertIsNone(_rtp_delta(before, before, **args), "absolute counters must not prove live RTP")
        missing_peer = copy.deepcopy(after)
        missing_peer["tracks"] = [row for row in missing_peer["tracks"] if row["actorPtid"] != "charlie"]
        self.assertIsNone(_rtp_delta(before, missing_peer, **args))
        replaced = copy.deepcopy(after)
        replaced["participantSid"] = "PA-new"
        self.assertIsNone(_rtp_delta(before, replaced, **args))
        no_frames = copy.deepcopy(after)
        for row in no_frames["tracks"]:
            row["frames"] = 2
        self.assertIsNone(_rtp_delta(before, no_frames, **args), "frozen video frames must not pass")

    def test_product_paths_use_provider_boundary_and_no_debug_probes(self) -> None:
        manager = self.source(
            "apps/desktop/src/modules/groupCall/groupCallManager.ts"
        )
        adapter = self.source(
            "packages/client-chat-core/src/group-call/livekitAdapter.ts"
        )
        controller = self.source("packages/client-chat-core/src/group-call/controller.ts")
        surface = self.source(
            "apps/desktop/src/components/chat/GroupCallSurface.tsx"
        )
        page = self.source("apps/desktop/src/pages/SocialChatPage.tsx")
        harness = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        desktop_main = self.source("apps/desktop/src-tauri/src/main.rs")
        realtime_commands = self.source(
            "apps/desktop/src-tauri/src/interface/tauri_commands/realtime.rs"
        )
        station = self.source(
            "apps/station/app/subserver/groupcall/livekit_adapter.go"
        )
        station_handler = self.source(
            "apps/station/app/subserver/groupcall/handler.go"
        )
        federation_routes = self.source(
            "apps/station/frame/core/federation/routes.go"
        )
        self.assertIn("this.attempt?.provider?.attachParticipantMedia", controller)
        self.assertIn("GroupCallController", manager)
        self.assertIn("Track.Source.Microphone", adapter)
        self.assertIn("data-group-call-remote-audio", surface)
        self.assertIn("<GroupCallSurface />", page)
        self.assertIn("groupCallStart", harness)
        self.assertIn("realtime::group_call_join", desktop_main)
        self.assertIn("pub fn group_call_join(", realtime_commands)
        self.assertIn('"/group-call/join"', realtime_commands)
        self.assertIn("APIURL", station)
        self.assertIn("PublicURL", station)
        self.assertIn("ResolveGroupCallAuthority", station_handler)
        self.assertIn("PeerRouteGroupCallAuthorityJoin", station_handler)
        self.assertIn("GroupCallAuthorityJoinRoute", federation_routes)
        self.assertNotIn(
            "s.members.ListGroupMemberPTIDs(ctx, req.GroupULID)",
            station_handler,
        )
        self.assertNotIn("LIVEKIT_HOST", station)
        self.assertNotIn("debug-point", page)
        self.assertNotIn("debug-point", harness)

    def test_validator_rejects_missing_receiver_rtp_and_mobile_substitution(self) -> None:
        actors = ("alice", "bob", "charlie")
        roster = [{"actorPtid": actor} for actor in actors]
        snapshots = {actor: {"state": "connected", "roomName": "gc-group", "participants": roster}
                     for actor in actors}
        media = {actor: {"roomSid": "RM-group", "participantSid": f"PA-{actor}",
                         "deltas": [{"actorPtid": peer, "trackSid": f"TR-{peer}-{kind}",
                                     "direction": "outbound" if peer == actor else "inbound",
                                     "kind": kind, "bytes": 100, "packets": 10, "frames": 2}
                                    for peer in actors for kind in ("audio", "video")]}
                 for actor in actors}
        released = {"state": "idle", "media": {"connected": False, "localLiveTracks": 0, "tracks": []}}
        evidence = {
            "clients": {actor: {"ptid": actor, "runtime": "tauri-ios-simulator" if actor == "charlie" else DESKTOP_RUNTIME_IDENTITY}
                        for actor in actors},
            **{phase: copy.deepcopy(snapshots) for phase in ("audio", "video", "lateJoin", "restart", "reconnected")},
            **{phase: copy.deepcopy(media) for phase in ("audioMedia", "videoMedia", "restartMedia", "reconnectMedia")},
            **{phase: {actor: copy.deepcopy(released) for actor in actors}
               for phase in ("audioReleased", "videoReleased")},
            "replay": {"denied": True, "previousSid": "PA-before", "replaySid": "PA-after",
                       "observedInitialDenial": True, "mediaReleased": True, "tokenKind": "initial"},
            "signalReconnect": {"requested": True, "observedReconnecting": True},
            "authorityRestart": {"beforeStartedAt": "before", "afterStartedAt": "after",
                                 "beforeCommit": "commit", "afterCommit": "commit"},
        }
        for phase in ("refreshedReplay", "authorityRestartReplay"):
            evidence[phase] = {**evidence["replay"], "tokenKind": "refreshed"}
        remaining_actors = ("alice", "charlie")
        evidence["sfuRecovered"] = {
            actor: {"state": "connected", "roomName": "gc-group",
                    "participants": [{"actorPtid": peer} for peer in remaining_actors]}
            for actor in remaining_actors
        }
        evidence["sfuRecoveryMedia"] = {
            actor: {**copy.deepcopy(media[actor]), "participantSid": f"PA-recovered-{actor}",
                    "deltas": [row for row in copy.deepcopy(media[actor]["deltas"])
                               if row["actorPtid"] in remaining_actors]}
            for actor in remaining_actors
        }
        before_sfu = {
            "host": "192.0.2.50", "url": "ws://192.0.2.50:7880",
            "container": "pt-secondary-livekit-1", "composeProject": "pt-secondary",
            "service": "livekit", "imageId": "sha256:" + "a" * 64,
            "sourceRevision": GROUP_SFU_SOURCE_REVISION, "admissionContract": GROUP_SFU_ADMISSION_CONTRACT,
            "health": "healthy", "startedAt": "before",
        }
        evidence["sfuRestart"] = {"before": before_sfu, "after": {**before_sfu, "startedAt": "after"}}
        for phase, kind in (("sfuRestartReplay", "refreshed"), ("memberReplay", "initial"),
                            ("memberRefreshedReplay", "refreshed"), ("sessionReplay", "initial"),
                            ("sessionRefreshedReplay", "refreshed")):
            evidence[phase] = {**evidence["replay"], "tokenKind": kind}
        for phase, remaining in (("memberRemoval", ("alice", "charlie")),
                                 ("deviceRevocation", ("alice", "charlie")),
                                 ("sessionRevocation", ("charlie",))):
            evidence[phase] = {"released": copy.deepcopy(released), "remaining": {
                actor: {"participants": [{"actorPtid": peer} for peer in remaining]} for actor in remaining}}
        steps = [{"step": step, "status": "pass"} for step in REQUIRED_STEPS]
        steps.extend({"step": "ui.action", "client": "charlie", "status": "pass", "selector": selector}
                     for selector in ('[data-group-call-start="audio"]', '[data-group-call-start="video"]',
                                      '[data-action-id="group-call.microphone"]', '[data-action-id="group-call.camera"]',
                                      '[data-action-id="group-call.leave"]'))
        report = {"runtime": {"journey": "chat-group-live-lifecycle", "groupLive": evidence, "steps": steps}}
        validate_group_live_report(report)
        missing_receiver = copy.deepcopy(report)
        missing_receiver["runtime"]["groupLive"]["videoMedia"]["alice"]["deltas"] = [
            row for row in media["alice"]["deltas"] if row["actorPtid"] != "charlie"]
        with self.assertRaisesRegex(RuntimeError, "lacks live"):
            validate_group_live_report(missing_receiver)
        substituted = copy.deepcopy(report)
        substituted["runtime"]["groupLive"]["clients"]["charlie"]["runtime"] = "native-tauri"
        with self.assertRaisesRegex(RuntimeError, "native Mobile"):
            validate_group_live_report(substituted)
        stationary = copy.deepcopy(report)
        stationary["runtime"]["groupLive"]["videoMedia"]["bob"]["deltas"][0]["packets"] = 0
        with self.assertRaisesRegex(RuntimeError, "lacks live"):
            validate_group_live_report(stationary)
        unobserved = copy.deepcopy(report)
        unobserved["runtime"]["groupLive"]["signalReconnect"]["observedReconnecting"] = False
        with self.assertRaisesRegex(RuntimeError, "reconnect"):
            validate_group_live_report(unobserved)
        initial_only = copy.deepcopy(report)
        initial_only["runtime"]["groupLive"]["refreshedReplay"]["tokenKind"] = "initial"
        with self.assertRaisesRegex(RuntimeError, "refreshedReplay"):
            validate_group_live_report(initial_only)
        no_restart = copy.deepcopy(report)
        no_restart["runtime"]["groupLive"]["authorityRestart"]["afterStartedAt"] = "before"
        with self.assertRaisesRegex(RuntimeError, "Authority restart"):
            validate_group_live_report(no_restart)
        for phase in ("sfuRestartReplay", "memberRefreshedReplay", "sessionRefreshedReplay"):
            candidate = copy.deepcopy(report)
            candidate["runtime"]["groupLive"][phase]["denied"] = False
            with self.subTest(phase=phase), self.assertRaisesRegex(RuntimeError, phase):
                validate_group_live_report(candidate)
        no_sfu_restart = copy.deepcopy(report)
        no_sfu_restart["runtime"]["groupLive"]["sfuRestart"]["after"]["startedAt"] = "before"
        with self.assertRaisesRegex(RuntimeError, "SFU restart"):
            validate_group_live_report(no_sfu_restart)
        missing_recovered_peer = copy.deepcopy(report)
        missing_recovered_peer["runtime"]["groupLive"]["sfuRecoveryMedia"]["alice"]["deltas"] = [
            row for row in evidence["sfuRecoveryMedia"]["alice"]["deltas"] if row["actorPtid"] == "alice"]
        with self.assertRaisesRegex(RuntimeError, "lacks live"):
            validate_group_live_report(missing_recovered_peer)
        stale_sfu_source = copy.deepcopy(report)
        stale_sfu_source["runtime"]["groupLive"]["sfuRestart"]["after"]["admissionContract"] = "stock"
        with self.assertRaisesRegex(RuntimeError, "admission source"):
            validate_group_live_report(stale_sfu_source)
        reused_sid = copy.deepcopy(report)
        reused_sid["runtime"]["groupLive"]["sfuRecoveryMedia"]["alice"]["participantSid"] = "PA-alice"
        with self.assertRaisesRegex(RuntimeError, "fresh authorized RTC"):
            validate_group_live_report(reused_sid)


if __name__ == "__main__":
    unittest.main()
