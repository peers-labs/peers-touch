from __future__ import annotations

import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core import DriverError, REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_live_voice import (
    GATE_ID,
    REQUIRED_LIVE_VOICE_ASSERTIONS,
    _media_harness,
)
from tooling.acceptance.gates.chat.lifecycle_live_voice_e2e import (
    REQUIRED_LIVE_VOICE_REPORT_ASSERTIONS,
    REQUIRED_LIVE_VOICE_STEPS,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    journey_for_gate,
)
from tooling.acceptance.provisioners.home_station import CLIENT_ROLES, GATE_ROLES


class LifecycleLiveVoiceContractTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (REPO_ROOT / path).read_text(encoding="utf-8")

    def test_media_harness_prefers_completed_action_over_probe_timeout(self) -> None:
        adapter = Mock()

        def delayed_probe_failure(_process_id: int) -> bool:
            time.sleep(0.05)
            raise DriverError("permission probe timed out")

        def completed_call(*_args: object, **_kwargs: object) -> dict[str, bool]:
            time.sleep(0.12)
            return {"started": True}

        adapter.accept_media_capture_permission_to_process.side_effect = (
            delayed_probe_failure
        )
        client = SimpleNamespace(process_id=42)
        binding = SimpleNamespace(native_adapter=adapter)

        with patch(
            "tooling.acceptance.gates.chat.lifecycle_live_voice.async_harness",
            side_effect=completed_call,
        ):
            result = _media_harness(
                client,
                binding,
                "callStart",
                {"peerPtid": "peer", "mediaKind": "audio"},
            )

        self.assertEqual(result, {"started": True})
        adapter.accept_media_capture_permission_to_process.assert_called_with(42)

    def test_feature_has_complete_chat_contract_trace(self) -> None:
        domain = json.loads(self.source("tooling/acceptance/domains/chat.yaml"))
        capabilities = json.loads(
            self.source("tooling/acceptance/capabilities/chat.yaml")
        )
        feature = json.loads(
            self.source(
                "tooling/acceptance/features/chat-live-voice-video.yaml"
            )
        )
        capability = next(
            item
            for item in capabilities["capabilities"]
            if item["id"] == "chat-live-voice-video"
        )

        self.assertIn(capability["id"], domain["capabilities"])
        self.assertIn(feature["id"], capability["features"])
        self.assertIn(GATE_ID, feature["required_gates"])
        self.assertIn(GATE_ID, capability["required_gates"])
        self.assertIn(GATE_ID, capability["evidence"]["proven_by"])

    def test_changed_live_call_paths_select_dedicated_gate(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "plan.json"
            subprocess.run(
                (
                    "python3",
                    "tooling/scripts/acceptance-plan.py",
                    "--changed-file",
                    "apps/desktop/src/modules/p2p/callP2p.ts",
                    "--changed-file",
                    "apps/desktop/src/components/chat/CallSurface.tsx",
                    "--changed-file",
                    "apps/desktop/src/acceptance/chat/harness.ts",
                    "--changed-file",
                    (
                        "tooling/acceptance/gates/chat/"
                        "lifecycle_live_voice.py"
                    ),
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
        self.assertIn(
            "chat-live-voice-video",
            plan["impacted_features"],
        )

    def test_gate_runs_product_journey_then_fail_closed_validator(self) -> None:
        gates = json.loads(self.source("tooling/acceptance/gates.yaml"))
        gate = gates["gates"][GATE_ID]
        self.assertEqual(
            gate["command"],
            (
                "python3 -m tooling.acceptance.gates.chat."
                "lifecycle_live_voice && "
                "python3 -m tooling.acceptance.gates.chat."
                "lifecycle_live_voice_e2e"
            ),
        )
        self.assertEqual(
            gate["environment"],
            "native-tauri-embedded-webdriver",
        )
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-macos-native"],
        )
        self.assertEqual(
            journey_for_gate(GATE_ID),
            "chat-live-voice-lifecycle",
        )
        self.assertEqual(GATE_ROLES[GATE_ID], ("alice", "bob"))
        self.assertEqual(CLIENT_ROLES[GATE_ID], ("alice", "bob"))

    def test_journey_requires_receiver_media_and_hardening_states(self) -> None:
        for assertion in (
            "call_audio_receiver_media_live",
            "call_video_local_preview_live",
            "call_video_receiver_media_live",
            "call_video_compact_layout",
            "call_video_chat_fill_layout",
            "call_video_fullscreen_layout",
            "call_video_device_switch",
            "call_reconnect_entered",
            "call_reconnect_recovered",
            "text_usable_during_call",
            "call_resources_released",
        ):
            self.assertIn(assertion, REQUIRED_LIVE_VOICE_ASSERTIONS)
            self.assertIn(
                assertion,
                REQUIRED_LIVE_VOICE_REPORT_ASSERTIONS,
            )
        for step in (
            "call.audio.lifecycle",
            "call.video.lifecycle",
            "call.text-during-active",
            "call.resources-released",
        ):
            self.assertIn(step, REQUIRED_LIVE_VOICE_STEPS)

    def test_runtime_uses_canonical_identity_and_production_actions(self) -> None:
        runtime = self.source("apps/desktop/src/modules/p2p/callP2p.ts")
        harness = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        gateway = self.source(
            "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"
        )
        gate = self.source(
            "tooling/acceptance/gates/chat/lifecycle_live_voice.py"
        )

        self.assertNotIn("sessionUlid.split('-')", runtime)
        self.assertIn("this.localActorPtid", runtime)
        self.assertIn("deriveSignalingSessionId(myDid, fromActorPtid)", runtime)
        self.assertIn("options.iceRestart ? { iceRestart: true } : undefined", runtime)
        self.assertIn("conn.pc.signalingState === 'have-local-offer'", runtime)
        self.assertIn("reason: 'outgoing call accepted'", runtime)
        self.assertIn("reason: 'incoming call accepted'", runtime)
        self.assertNotIn("pc.onnegotiationneeded", runtime)
        self.assertIn("api.iceGetServers()", runtime)
        self.assertIn("callRestartConnection", harness)
        self.assertIn("callSwitchVideoDevice", harness)
        self.assertIn(
            "station::station_set_active_with_state(",
            gateway,
        )
        self.assertIn(
            "device.deviceId !== currentDeviceId",
            harness,
        )
        self.assertIn("send_text(alice, text)", gate)
        self.assertIn("_has_live_track", gate)
        self.assertIn("ThreadPoolExecutor", gate)
        self.assertIn(
            ".accept_media_capture_permission_to_process(",
            gate,
        )
        self.assertNotIn('async_harness(alice, "callStart"', gate)
        self.assertNotIn('async_harness(bob, "callAccept"', gate)
        self.assertNotIn("def run_steps(", gate)


if __name__ == "__main__":
    unittest.main()
