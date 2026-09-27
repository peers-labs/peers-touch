from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_rich_voice import (
    GATE_ID,
    LifecycleRichVoiceGate,
    REQUIRED_RICH_VOICE_ASSERTIONS,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    is_current_profile_gate,
    journey_for_gate,
)


class LifecycleRichVoiceContractTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (REPO_ROOT / path).read_text(encoding="utf-8")

    def test_feature_is_connected_to_chat_capability_and_domain(self) -> None:
        domain = json.loads(self.source("tooling/acceptance/domains/chat.yaml"))
        capabilities = json.loads(
            self.source("tooling/acceptance/capabilities/chat.yaml")
        )
        capability = next(
            item
            for item in capabilities["capabilities"]
            if item["id"] == "chat-rich-media-recorded-voice"
        )

        self.assertIn("chat-rich-media-recorded-voice", domain["capabilities"])
        self.assertEqual(
            capability["features"],
            ["chat-rich-media-recorded-voice"],
        )
        self.assertIn(GATE_ID, capability["required_gates"])
        self.assertEqual(capability["evidence"]["proven_by"], [GATE_ID])

    def test_changed_rich_media_paths_select_the_dedicated_gate(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "plan.json"
            subprocess.run(
                (
                    "python3",
                    "tooling/scripts/acceptance-plan.py",
                    "--changed-file",
                    "model/domain/chat/attachment.proto",
                    "--changed-file",
                    "apps/desktop/src/components/chat/AttachmentItem.tsx",
                    "--changed-file",
                    "tooling/acceptance/gates/chat/lifecycle_rich_voice.py",
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
            "chat-rich-media-recorded-voice",
            plan["impacted_features"],
        )

    def test_voice_metadata_is_private_and_typed(self) -> None:
        proto = self.source("model/domain/chat/attachment.proto")
        descriptor = proto[
            proto.index("message EncryptedObjectDescriptor"):
            proto.index("message AttachmentPlaintextMetadata")
        ]
        private_metadata = proto[
            proto.index("message AttachmentPlaintextMetadata"):
            proto.index("message MessagePrivateContent")
        ]

        self.assertNotIn("content_kind", descriptor)
        self.assertNotIn("duration_ms", descriptor)
        self.assertIn("AttachmentContentKind content_kind = 9;", private_metadata)
        self.assertIn("uint32 duration_ms = 10;", private_metadata)

    def test_native_journey_requires_transport_loss_and_terminal_playback(self) -> None:
        self.assertTrue(is_current_profile_gate(GATE_ID))
        self.assertEqual(journey_for_gate(GATE_ID), "rich-media-recorded-voice")
        for assertion in (
            "rich_attachment_upload_retry_identity",
            "rich_attachment_download_retry_identity",
            "voice_playback_terminal_end",
        ):
            self.assertIn(assertion, REQUIRED_RICH_VOICE_ASSERTIONS)

        runner = self.source(
            "tooling/acceptance/gates/chat/lifecycle_rich_voice.py"
        )
        for contract in (
            "AcceptanceStationAttachmentFaultProxy",
            "create_transport_override(",
            "apply_transport_override(",
            "clear_transport_override(",
            'data-chat-voice-playback-state',
            "proxy_started = False",
            "upload_override = None",
            "download_override = None",
            "if upload_override is not None:",
            "if download_override is not None:",
            "if proxy_started:",
            "if cooperative_activation:",
            "adapter.select_file_chooser_path_to_process(",
            ".accept_media_capture_permission_to_process(",
            "if selected_control is not None:",
            "adapter.reveal_file_chooser_location()",
            "def post_chooser_key(",
            "restored_activation = (",
            'client.driver.execute_script("return document.hasFocus()")',
            "native window bounds are unavailable after",
            "def _native_click(",
            "adapter.post_mouse((MouseAction.LEFT_DOWN,), point)",
            "adapter.drag_mouse(",
            "def _engine_attachment(",
            "def _voice_surface_snapshot(",
            "ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER",
            "for reveal_attempt in range(1, 5):",
            "after bounded target-owned retries",
        ):
            self.assertIn(contract, runner)

    def test_voice_surface_serializes_boolean_data_contract(self) -> None:
        attachment_item = self.source(
            "apps/desktop/src/components/chat/AttachmentItem.tsx"
        )
        for contract in (
            "data-chat-voice-note={isVoiceNote ? 'true' : undefined}",
            "data-chat-voice-terminal={audioFailed ? 'true' : 'false'}",
            "data-chat-voice-playing={audioPlaying ? 'true' : 'false'}",
        ):
            self.assertIn(contract, attachment_item)

    def test_confirm_geometry_allows_only_bottom_anchored_composer_expansion(
        self,
    ) -> None:
        before = {
            "native": {
                "bounds": {
                    "left": 864,
                    "top": 33,
                    "width": 864,
                    "height": 800,
                },
            },
            "renderer": {
                "screenX": 0,
                "screenY": 1117,
                "outerWidth": 0,
                "outerHeight": 0,
                "innerWidth": 864,
                "innerHeight": 768,
                "devicePixelRatio": 2,
                "pane": {
                    "left": 347.9,
                    "top": -48,
                    "width": 516.1,
                    "height": 768,
                },
                "composer": {
                    "left": 347.9,
                    "top": 582.9,
                    "width": 516.1,
                    "height": 137.1,
                },
            },
        }
        after = json.loads(json.dumps(before))
        after["renderer"]["composer"].update(
            {
                "top": 461.9,
                "height": 258.1,
            }
        )

        self.assertFalse(LifecycleRichVoiceGate._geometry_equal(before, after))
        self.assertTrue(
            LifecycleRichVoiceGate._geometry_equal(
                before,
                after,
                allow_composer_expansion=True,
            )
        )

        after["renderer"]["pane"]["width"] = 500
        self.assertFalse(
            LifecycleRichVoiceGate._geometry_equal(
                before,
                after,
                allow_composer_expansion=True,
            )
        )

    def test_composer_requires_preview_before_voice_send(self) -> None:
        composer = self.source(
            "apps/desktop/src/components/chat/ChatComposer.tsx"
        )
        for selector in (
            'data-chat-voice-recording',
            'data-chat-voice-cancel',
            'data-chat-voice-finish',
            'data-chat-voice-draft="preview"',
            'data-chat-voice-discard',
            'data-chat-voice-send',
        ):
            self.assertIn(selector, composer)
        self.assertIn("contentKind: 'voice_note'", composer)
        self.assertNotIn("onRecorded: (file) =>", composer)


if __name__ == "__main__":
    unittest.main()
