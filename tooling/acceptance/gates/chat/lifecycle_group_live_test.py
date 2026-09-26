from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.gates.chat import lifecycle_group_live
from tooling.acceptance.gates.chat.lifecycle_group_live import (
    GATE_ID,
    REQUIRED_ASSERTIONS,
)
from tooling.acceptance.gates.chat.lifecycle_group_live_e2e import REQUIRED_STEPS
from tooling.acceptance.provisioners.home_station import CLIENT_ROLES, GATE_ROLES


class LifecycleGroupLiveContractTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (REPO_ROOT / path).read_text(encoding="utf-8")

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
            gate["command"],
            (
                "python3 -m tooling.acceptance.gates.chat.lifecycle_group_live "
                "&& python3 -m tooling.acceptance.gates.chat."
                "lifecycle_group_live_e2e"
            ),
        )
        self.assertEqual(
            gate["environment"],
            "native-tauri-embedded-webdriver",
        )
        self.assertEqual(GATE_ROLES[GATE_ID], ("alice", "bob", "charlie"))
        self.assertEqual(CLIENT_ROLES[GATE_ID], ("alice", "bob", "charlie"))

    def test_validator_declares_group_live_variant_identity(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/lifecycle_group_live.py"
        )
        validator = self.source(
            "tooling/acceptance/gates/chat/lifecycle_group_live_e2e.py"
        )
        self.assertIn('"runtimeCellRunId": identity["runtimeCell"].get("runId")', runner)
        self.assertIn(
            'expected_journey="chat-group-live-lifecycle"',
            validator,
        )
        self.assertIn("expected_actor_roles=frozenset(ACTORS)", validator)

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
        clients = {actor: object() for actor in ("alice", "bob", "charlie")}
        snapshots = {
            client: {
                "state": "connected",
                "participants": [
                    {
                        "actorPtid": "charlie-ptid",
                        "isMicEnabled": actor == "alice",
                    },
                    {"actorPtid": "peer-1", "isMicEnabled": True},
                    {"actorPtid": "peer-2", "isMicEnabled": True},
                ],
            }
            for actor, client in clients.items()
        }
        with patch.object(
            lifecycle_group_live,
            "_snapshot",
            side_effect=lambda client: snapshots[client],
        ):
            self.assertIsNone(
                lifecycle_group_live._all_connected_with_participant_state(
                    clients,
                    participant_count=3,
                    actor_ptid="charlie-ptid",
                    field="isMicEnabled",
                    expected=False,
                )
            )
            snapshots[clients["alice"]]["participants"][0]["isMicEnabled"] = False
            self.assertEqual(
                set(
                    lifecycle_group_live._all_connected_with_participant_state(
                        clients,
                        participant_count=3,
                        actor_ptid="charlie-ptid",
                        field="isMicEnabled",
                        expected=False,
                    )
                    or {}
                ),
                set(clients),
            )

    def test_product_paths_use_provider_boundary_and_no_debug_probes(self) -> None:
        manager = self.source(
            "apps/desktop/src/modules/groupCall/groupCallManager.ts"
        )
        adapter = self.source(
            "apps/desktop/src/modules/groupCall/livekitAdapter.ts"
        )
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
        self.assertIn("this.provider.attachParticipantMedia", manager)
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


if __name__ == "__main__":
    unittest.main()
