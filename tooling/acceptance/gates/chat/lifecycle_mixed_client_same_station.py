#!/usr/bin/env python3
"""Prove Desktop<->Mobile same-Station interoperability."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import time
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
)
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
    compact_json,
)
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)

GATE_ID = "chat-lifecycle-mixed-client-same-station-e2e"
REPORT_PATH = None
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))

REQUIRED_ASSERTIONS = frozenset({
    "direct_message_delivery",
    "group_message_delivery",
    "read_receipt_convergence",
    "typing_indicator_cross_client",
    "attachment_preview_parity",
    "conversation_list_sync",
})


class MixedClientSameStationGate(AcceptanceGate):
    """Desktop Alice <-> Mobile Charlie on Station primary."""

    gate_id = GATE_ID
    phase = "CCU-W06"
    bom = ("CCU-G06",)
    spec = ("chat-lifecycle-mixed-client",)
    report_path = REPORT_PATH
    evidence_dir = None

    def __init__(
        self,
        *,
        runtime: MixedNativeRuntime | None = None,
    ) -> None:
        super().__init__()
        self.runtime = runtime or MixedNativeRuntime.from_environment(
            self.gate_id
        )
        self.runtime_binding = self.runtime.desktop_binding
        self.report.manifest = self.runtime.manifest
        self.report.runtime.update(
            {
                "runtimeCell": "desktop-macos-native+ios-simulator",
                "journey": "mixed-client-same-station",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        desktop_id = "desktop-alice"
        mobile_id = "sim-ios-peer"
        cleanup: dict[str, Any] = {}
        try:
            for index, client_id in enumerate((desktop_id, mobile_id)):
                self.runtime.start_client(
                    client_id,
                    window_slot=index,
                    window_count=2,
                )
                self.report.add_actor(
                    self.runtime.actor_runtime(client_id)
                )
            desktop = self.runtime.identities[desktop_id]
            mobile = self.runtime.identities[mobile_id]
            if desktop.station_service_id != mobile.station_service_id:
                raise GateError("same-Station clients use different Stations")
            source_identity = self.runtime.source_identity()

            direct_id = self.runtime.create_direct(
                desktop_id,
                mobile_id,
                federation_id=desktop.federation_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            self.runtime.submit_typing(desktop_id, direct_id, True)
            self.runtime.wait_until(
                lambda: self.runtime.typing_visible(
                    mobile_id,
                    direct_id,
                    desktop.ptid,
                ),
                "Mobile typing projection",
                timeout_seconds=STEP_TIMEOUT,
            )
            self.runtime.submit_typing(desktop_id, direct_id, False)
            self.assert_condition("typing_indicator_cross_client", True)

            desktop_text = f"ccu-same-desktop-{time.time_ns()}"
            desktop_message_id = self.runtime.send_message(
                desktop_id,
                direct_id,
                desktop_text,
                kind="direct",
            )
            mobile_received = self.runtime.wait_for_message(
                mobile_id,
                direct_id,
                desktop_message_id,
                lambda value: value.get("plaintext") == desktop_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Mobile receives Desktop Direct",
            )
            sequence = int(mobile_received.get("eventSequence") or 0)
            if sequence <= 0:
                raise GateError("Direct receiver sequence is missing")
            self.runtime.submit_read(
                mobile_id,
                direct_id,
                sequence,
                kind="direct",
            )
            desktop_receipt = self.runtime.wait_for_message(
                desktop_id,
                direct_id,
                desktop_message_id,
                lambda value: mobile.ptid in value.get("readByPtids", ()),
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop read receipt from Mobile",
            )
            self.assert_condition(
                "read_receipt_convergence",
                mobile.ptid in desktop_receipt.get("readByPtids", ()),
                compact_json(desktop_receipt),
            )

            mobile_text = f"ccu-same-mobile-{time.time_ns()}"
            mobile_message_id = self.runtime.send_message(
                mobile_id,
                direct_id,
                mobile_text,
                kind="direct",
            )
            desktop_received = self.runtime.wait_for_message(
                desktop_id,
                direct_id,
                mobile_message_id,
                lambda value: value.get("plaintext") == mobile_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop receives Mobile Direct",
            )
            self.assert_condition(
                "direct_message_delivery",
                (
                    mobile_received.get("messageId") == desktop_message_id
                    and desktop_received.get("messageId") == mobile_message_id
                ),
            )

            attachment_bytes = b"peers-touch mixed-client attachment\n"
            attachment_sha256 = hashlib.sha256(
                attachment_bytes
            ).hexdigest()
            staged = self.runtime.stage_attachment(
                mobile_id,
                filename="mixed-client.txt",
                mime_type="text/plain",
                bytes_base64=base64.b64encode(attachment_bytes).decode("ascii"),
                sha256=attachment_sha256,
            )
            attachment_send = self.runtime.call_action(
                mobile_id,
                "messaging.send",
                {
                    "conversationId": direct_id,
                    "plaintext": "mixed attachment",
                    "attachmentStageIds": [staged["stageId"]],
                },
            )
            if not isinstance(attachment_send, dict):
                raise GateError("Mobile attachment send result is invalid")
            attachment_message_id = str(
                attachment_send.get("messageId") or ""
            )
            attachment_ids = attachment_send.get("attachmentIds")
            if (
                not attachment_message_id
                or not isinstance(attachment_ids, list)
                or len(attachment_ids) != 1
            ):
                raise GateError("Mobile attachment identity is incomplete")
            self.runtime.wait_for_message(
                desktop_id,
                direct_id,
                attachment_message_id,
                lambda value: value.get("plaintext") == "mixed attachment",
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop receives Mobile attachment message",
            )
            opened = self.runtime.wait_until(
                lambda: self.runtime.open_attachment(
                    desktop_id,
                    str(attachment_ids[0]),
                ),
                "Desktop attachment local cache",
                timeout_seconds=STEP_TIMEOUT,
            )
            local_path = Path(str(opened.get("localPath") or ""))
            self.assert_condition(
                "attachment_preview_parity",
                (
                    local_path.is_file()
                    and hashlib.sha256(local_path.read_bytes()).hexdigest()
                    == attachment_sha256
                ),
                compact_json(
                    {
                        "attachmentId": attachment_ids[0],
                        "sha256": attachment_sha256,
                    }
                ),
            )

            group_id = self.runtime.create_group(
                desktop_id,
                (mobile_id,),
                federation_id=desktop.federation_id,
                name="CCU Same Station",
                timeout_seconds=STEP_TIMEOUT,
            )
            group_text = f"ccu-same-group-{time.time_ns()}"
            group_message_id = self.runtime.send_message(
                mobile_id,
                group_id,
                group_text,
                kind="group",
            )
            group_received = self.runtime.wait_for_message(
                desktop_id,
                group_id,
                group_message_id,
                lambda value: value.get("plaintext") == group_text,
                kind="group",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop receives Mobile Group message",
            )
            self.assert_condition(
                "group_message_delivery",
                group_received.get("messageId") == group_message_id,
            )
            self.assert_condition(
                "conversation_list_sync",
                bool(
                    self.runtime.conversation_snapshot(
                        desktop_id,
                        direct_id,
                        kind="direct",
                    )
                )
                and bool(
                    self.runtime.conversation_snapshot(
                        mobile_id,
                        direct_id,
                        kind="direct",
                    )
                )
                and bool(
                    self.runtime.conversation_snapshot(
                        desktop_id,
                        group_id,
                        kind="group",
                    )
                )
                and bool(
                    self.runtime.conversation_snapshot(
                        mobile_id,
                        group_id,
                        kind="group",
                    )
                ),
            )

            desktop_session = self.runtime.desktop_session(desktop_id)
            if desktop_session is not None:
                self.save_screenshot(desktop_session, desktop_id)
                self.save_dom(desktop_session, desktop_id)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Mixed-client same-Station",
            )
            self.report.runtime["cleanup"] = cleanup

        missing = REQUIRED_ASSERTIONS - {
            assertion.name for assertion in self.report.assertions
        }
        if missing:
            raise GateError(
                f"required assertions are missing: {sorted(missing)}"
            )
        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Mixed-client same-Station cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "stationServiceId": desktop.station_service_id,
            "directConversationId": direct_id,
            "groupConversationId": group_id,
            "cleanup": cleanup,
        }


def main() -> int:
    return MixedClientSameStationGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
