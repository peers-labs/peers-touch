#!/usr/bin/env python3
"""Prove Desktop<->Mobile cross-Station interoperability."""

from __future__ import annotations

import json
import os
import time
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
    compact_json,
)
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)

GATE_ID = "chat-lifecycle-mixed-client-cross-station-e2e"
REPORT_PATH = REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))

REQUIRED_ASSERTIONS = frozenset({
    "federated_direct_delivery",
    "federated_group_delivery",
    "offline_queue_drain",
    "reconnect_state_recovery",
    "cross_station_typing",
    "cross_station_receipt",
})


class MixedClientCrossStationGate(AcceptanceGate):
    """Desktop (alice, Station A) <-> Mobile (bob, Station B)."""

    gate_id = GATE_ID
    phase = "CCU-W06"
    bom = ("CCU-G06",)
    spec = ("chat-lifecycle-mixed-client",)
    report_path = REPORT_PATH
    evidence_dir = REPORT_PATH.parent / f"{GATE_ID}-evidence"

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
                "journey": "mixed-client-cross-station",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        desktop_id = "desktop-alice"
        mobile_id = "sim-ios"
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
            if desktop.station_service_id == mobile.station_service_id:
                raise GateError("cross-Station clients share one Station")
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
                "cross-Station Mobile typing projection",
                timeout_seconds=STEP_TIMEOUT,
            )
            self.runtime.submit_typing(desktop_id, direct_id, False)
            self.assert_condition("cross_station_typing", True)

            direct_text = f"ccu-cross-direct-{time.time_ns()}"
            direct_message_id = self.runtime.send_message(
                desktop_id,
                direct_id,
                direct_text,
                kind="direct",
            )
            mobile_received = self.runtime.wait_for_message(
                mobile_id,
                direct_id,
                direct_message_id,
                lambda value: value.get("plaintext") == direct_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="cross-Station Mobile Direct delivery",
            )
            self.assert_condition(
                "federated_direct_delivery",
                mobile_received.get("messageId") == direct_message_id,
            )

            sequence = int(mobile_received.get("eventSequence") or 0)
            if sequence <= 0:
                raise GateError("cross-Station message sequence is missing")
            self.runtime.submit_read(
                mobile_id,
                direct_id,
                sequence,
                kind="direct",
            )
            sender_receipt = self.runtime.wait_for_message(
                desktop_id,
                direct_id,
                direct_message_id,
                lambda value: mobile.ptid in value.get("readByPtids", ()),
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="cross-Station Desktop read receipt",
            )
            self.assert_condition(
                "cross_station_receipt",
                mobile.ptid in sender_receipt.get("readByPtids", ()),
                compact_json(sender_receipt),
            )

            self.runtime.set_mobile_suspended(mobile_id, True)
            offline_text = f"ccu-cross-offline-{time.time_ns()}"
            offline_message_id = self.runtime.send_message(
                desktop_id,
                direct_id,
                offline_text,
                kind="direct",
            )
            self.runtime.set_mobile_suspended(mobile_id, False)
            offline_received = self.runtime.wait_for_message(
                mobile_id,
                direct_id,
                offline_message_id,
                lambda value: value.get("plaintext") == offline_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="cross-Station offline queue drain",
            )
            self.assert_condition(
                "offline_queue_drain",
                offline_received.get("messageId") == offline_message_id,
            )

            self.runtime.interact(
                mobile_id,
                direct_id,
                offline_message_id,
                kind="direct",
                interaction="reaction",
                reaction="ack",
            )
            self.runtime.wait_for_message(
                desktop_id,
                direct_id,
                offline_message_id,
                lambda value: any(
                    isinstance(reaction, dict)
                    and reaction.get("actorPtid") == mobile.ptid
                    and reaction.get("reaction") == "ack"
                    for reaction in value.get("reactions", ())
                ),
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="cross-Station interaction convergence",
            )

            self.runtime.restart_client(
                mobile_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            restart_readback = self.runtime.wait_for_message(
                mobile_id,
                direct_id,
                offline_message_id,
                lambda value: value.get("plaintext") == offline_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="cross-Station Mobile restart readback",
            )
            self.assert_condition(
                "reconnect_state_recovery",
                (
                    restart_readback.get("messageId")
                    == offline_message_id
                    and self.runtime.message_occurrences(
                        mobile_id,
                        direct_id,
                        offline_message_id,
                        kind="direct",
                    )
                    == 1
                ),
                compact_json(restart_readback),
            )

            group_id = self.runtime.create_group(
                desktop_id,
                (mobile_id,),
                federation_id=desktop.federation_id,
                name="CCU Cross Station",
                timeout_seconds=STEP_TIMEOUT,
            )
            group_text = f"ccu-cross-group-{time.time_ns()}"
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
                description="cross-Station Desktop Group delivery",
            )
            self.assert_condition(
                "federated_group_delivery",
                group_received.get("messageId") == group_message_id,
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
                "Mixed-client cross-Station",
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
                "Mixed-client cross-Station cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "stationServiceIds": [
                desktop.station_service_id,
                mobile.station_service_id,
            ],
            "directConversationId": direct_id,
            "groupConversationId": group_id,
            "cleanup": cleanup,
        }


def main() -> int:
    return MixedClientCrossStationGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
