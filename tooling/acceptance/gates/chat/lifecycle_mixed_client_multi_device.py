#!/usr/bin/env python3
"""Prove same-actor Desktop + Mobile multi-device convergence."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Mapping
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

GATE_ID = "chat-lifecycle-mixed-client-multi-device-e2e"
REPORT_PATH = REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))

REQUIRED_ASSERTIONS = frozenset({
    "sender_companion_fanout",
    "read_cursor_convergence",
    "device_revoke_propagation",
    "identity_isolation",
    "notification_dedup",
})


class MixedClientMultiDeviceGate(AcceptanceGate):
    """alice on Desktop + Mobile (same actor, two devices)."""

    gate_id = GATE_ID
    phase = "CCU-W05"
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
                "journey": "mixed-client-multi-device",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        client_ids = ("desktop-alice", "desktop-bob", "sim-ios")
        cleanup: dict[str, Any] = {}
        try:
            for index, client_id in enumerate(client_ids):
                self.runtime.start_client(
                    client_id,
                    window_slot=index,
                    window_count=len(client_ids),
                )
                self.report.add_actor(
                    self.runtime.actor_runtime(client_id)
                )

            source_identity = self.runtime.source_identity()
            alice = self.runtime.identities["desktop-alice"]
            desktop_bob = self.runtime.identities["desktop-bob"]
            mobile_bob = self.runtime.identities["sim-ios"]
            self.assert_condition(
                "identity_isolation",
                (
                    alice.ptid != desktop_bob.ptid
                    and desktop_bob.ptid == mobile_bob.ptid
                    and desktop_bob.device_id != mobile_bob.device_id
                    and desktop_bob.station_service_id
                    == mobile_bob.station_service_id
                ),
                compact_json(
                    {
                        "alice": {
                            "ptid": alice.ptid,
                            "deviceId": alice.device_id,
                        },
                        "desktopBob": {
                            "ptid": desktop_bob.ptid,
                            "deviceId": desktop_bob.device_id,
                        },
                        "mobileBob": {
                            "ptid": mobile_bob.ptid,
                            "deviceId": mobile_bob.device_id,
                        },
                    }
                ),
            )

            conversation_id = self.runtime.create_direct(
                "desktop-alice",
                "desktop-bob",
                federation_id=alice.federation_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            first_text = f"ccu-multi-device-{time.time_ns()}"
            first_message_id = self.runtime.send_message(
                "desktop-alice",
                conversation_id,
                first_text,
                kind="direct",
            )
            desktop_message = self.runtime.wait_for_message(
                "desktop-bob",
                conversation_id,
                first_message_id,
                lambda value: value.get("plaintext") == first_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop Bob receiver projection",
            )
            mobile_message = self.runtime.wait_for_message(
                "sim-ios",
                conversation_id,
                first_message_id,
                lambda value: value.get("plaintext") == first_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Mobile Bob receiver projection",
            )
            self.assert_condition(
                "notification_dedup",
                (
                    self.runtime.message_occurrences(
                        "desktop-bob",
                        conversation_id,
                        first_message_id,
                        kind="direct",
                    )
                    == 1
                    and self.runtime.message_occurrences(
                        "sim-ios",
                        conversation_id,
                        first_message_id,
                        kind="direct",
                    )
                    == 1
                ),
            )

            sequence = int(
                mobile_message.get("eventSequence")
                or desktop_message.get("eventSequence")
                or 0
            )
            if sequence <= 0:
                raise GateError("receiver message sequence is missing")
            self.runtime.submit_read(
                "sim-ios",
                conversation_id,
                sequence,
                kind="direct",
            )
            desktop_read = self.runtime.wait_for_message(
                "desktop-bob",
                conversation_id,
                first_message_id,
                lambda value: desktop_bob.ptid
                in value.get("readByPtids", ()),
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop companion read cursor",
            )
            self.assert_condition(
                "read_cursor_convergence",
                desktop_bob.ptid in desktop_read.get("readByPtids", ()),
                compact_json(desktop_read),
            )

            companion_text = f"ccu-companion-{time.time_ns()}"
            companion_message_id = self.runtime.send_message(
                "sim-ios",
                conversation_id,
                companion_text,
                kind="direct",
            )
            desktop_companion = self.runtime.wait_for_message(
                "desktop-bob",
                conversation_id,
                companion_message_id,
                lambda value: value.get("plaintext") == companion_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop sender companion projection",
            )
            alice_received = self.runtime.wait_for_message(
                "desktop-alice",
                conversation_id,
                companion_message_id,
                lambda value: value.get("plaintext") == companion_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Alice receives Mobile Bob message",
            )
            self.assert_condition(
                "sender_companion_fanout",
                (
                    desktop_companion.get("messageId")
                    == companion_message_id
                    and alice_received.get("messageId")
                    == companion_message_id
                ),
            )

            revoke = self.runtime.revoke_current_device("desktop-bob")
            revoked_device_id = str(
                revoke.get("deviceIdentityDigest") or ""
            )
            post_revoke_text = f"ccu-post-revoke-{time.time_ns()}"
            post_revoke_message_id = self.runtime.send_message(
                "desktop-alice",
                conversation_id,
                post_revoke_text,
                kind="direct",
            )
            mobile_after_revoke = self.runtime.wait_for_message(
                "sim-ios",
                conversation_id,
                post_revoke_message_id,
                lambda value: value.get("plaintext") == post_revoke_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Mobile survivor after Desktop revoke",
            )
            desktop_received_after_revoke = False
            try:
                time.sleep(1)
                desktop_received_after_revoke = (
                    self.runtime.message_projection(
                        "desktop-bob",
                        conversation_id,
                        post_revoke_message_id,
                        kind="direct",
                    )
                    is not None
                )
            except Exception:
                desktop_received_after_revoke = False
            self.assert_condition(
                "device_revoke_propagation",
                (
                    revoked_device_id == desktop_bob.device_id
                    and mobile_after_revoke.get("messageId")
                    == post_revoke_message_id
                    and not desktop_received_after_revoke
                ),
            )

            self.runtime.restart_client(
                "sim-ios",
                timeout_seconds=STEP_TIMEOUT,
            )
            restored = self.runtime.wait_for_message(
                "sim-ios",
                conversation_id,
                post_revoke_message_id,
                lambda value: value.get("plaintext") == post_revoke_text,
                kind="direct",
                timeout_seconds=STEP_TIMEOUT,
                description="Mobile restart recovery",
            )
            self.assert_condition(
                "sender_companion_recovery",
                restored.get("messageId") == post_revoke_message_id,
                compact_json(restored),
            )

            for client_id in ("desktop-alice", "desktop-bob"):
                client = self.runtime.desktop_session(client_id)
                if client is not None:
                    self.save_screenshot(client, client_id)
                    self.save_dom(client, client_id)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Mixed-client multi-device",
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
                "Mixed-client multi-device cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "conversationId": conversation_id,
            "messageIds": [
                first_message_id,
                companion_message_id,
                post_revoke_message_id,
            ],
            "cleanup": cleanup,
        }


def main() -> int:
    return MixedClientMultiDeviceGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
