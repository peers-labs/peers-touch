#!/usr/bin/env python3
"""Prove three-actor mixed-client Group membership with MLS epochs."""

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

GATE_ID = "chat-lifecycle-mixed-client-group-mls-e2e"
REPORT_PATH = REPO_ROOT / "tooling" / "acceptance" / "reports" / f"{GATE_ID}.json"
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))

REQUIRED_ASSERTIONS = frozenset({
    "group_create_mixed",
    "mls_epoch_advance",
    "member_add_cross_client",
    "member_remove_propagation",
    "rejoin_epoch_recovery",
    "group_message_encrypted_delivery",
})


class MixedClientGroupMlsGate(AcceptanceGate):
    """Alice Desktop with Bob and Charlie Mobile clients."""

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
                "runtimeCell": "desktop-macos-native+dual-ios-simulator",
                "journey": "mixed-client-group-mls",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        owner_id = "desktop-alice"
        bob_id = "sim-ios"
        charlie_id = "sim-ios-peer"
        client_ids = (owner_id, bob_id, charlie_id)
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
            owner = self.runtime.identities[owner_id]
            bob = self.runtime.identities[bob_id]
            charlie = self.runtime.identities[charlie_id]

            group_id = self.runtime.create_group(
                owner_id,
                (bob_id, charlie_id),
                federation_id=owner.federation_id,
                name="CCU Mixed MLS",
                timeout_seconds=STEP_TIMEOUT,
            )
            expected_members = {owner.ptid, bob.ptid, charlie.ptid}
            bob_initial = self.runtime.conversation_snapshot(
                bob_id,
                group_id,
                kind="group",
            )
            charlie_initial = self.runtime.conversation_snapshot(
                charlie_id,
                group_id,
                kind="group",
            )
            if not isinstance(bob_initial, Mapping) or not isinstance(
                charlie_initial,
                Mapping,
            ):
                raise GateError("mixed Group projections are unavailable")
            initial_epoch = min(
                int(bob_initial.get("mlsEpoch") or 0),
                int(charlie_initial.get("mlsEpoch") or 0),
            )
            self.assert_condition(
                "group_create_mixed",
                (
                    set(bob_initial.get("memberPtids", ()))
                    == expected_members
                    and set(charlie_initial.get("memberPtids", ()))
                    == expected_members
                    and initial_epoch > 0
                ),
                compact_json(
                    {
                        "bob": bob_initial,
                        "charlie": charlie_initial,
                    }
                ),
            )

            first_text = f"ccu-group-initial-{time.time_ns()}"
            first_message_id = self.runtime.send_message(
                owner_id,
                group_id,
                first_text,
                kind="group",
            )
            for receiver_id in (bob_id, charlie_id):
                self.runtime.wait_for_message(
                    receiver_id,
                    group_id,
                    first_message_id,
                    lambda value, text=first_text: (
                        value.get("plaintext") == text
                    ),
                    kind="group",
                    timeout_seconds=STEP_TIMEOUT,
                    description=f"{receiver_id} initial Group delivery",
                )

            self.runtime.remove_group_member(
                owner_id,
                group_id,
                bob.ptid,
            )
            charlie_removed = self.runtime.wait_until(
                lambda: (
                    snapshot
                    if (
                        isinstance(
                            snapshot := self.runtime.conversation_snapshot(
                                charlie_id,
                                group_id,
                                kind="group",
                            ),
                            Mapping,
                        )
                        and bob.ptid
                        not in snapshot.get("memberPtids", ())
                    )
                    else None
                ),
                "Charlie observes Bob removal",
                timeout_seconds=STEP_TIMEOUT,
            )
            removed_epoch = int(charlie_removed.get("mlsEpoch") or 0)
            self.assert_condition(
                "member_remove_propagation",
                (
                    bob.ptid not in charlie_removed.get("memberPtids", ())
                    and removed_epoch > initial_epoch
                ),
                compact_json(charlie_removed),
            )

            removed_text = f"ccu-group-after-remove-{time.time_ns()}"
            removed_message_id = self.runtime.send_message(
                owner_id,
                group_id,
                removed_text,
                kind="group",
            )
            self.runtime.wait_for_message(
                charlie_id,
                group_id,
                removed_message_id,
                lambda value: value.get("plaintext") == removed_text,
                kind="group",
                timeout_seconds=STEP_TIMEOUT,
                description="remaining Mobile member receives post-remove message",
            )
            bob_received_removed_message = False
            try:
                time.sleep(1)
                bob_received_removed_message = (
                    self.runtime.message_projection(
                        bob_id,
                        group_id,
                        removed_message_id,
                        kind="group",
                    )
                    is not None
                )
            except Exception:
                bob_received_removed_message = False
            if bob_received_removed_message:
                raise GateError("removed Mobile member received future content")

            self.runtime.add_group_member(
                owner_id,
                group_id,
                bob.ptid,
            )
            bob_rejoined = self.runtime.wait_until(
                lambda: (
                    snapshot
                    if (
                        isinstance(
                            snapshot := self.runtime.conversation_snapshot(
                                bob_id,
                                group_id,
                                kind="group",
                            ),
                            Mapping,
                        )
                        and set(snapshot.get("memberPtids", ()))
                        == expected_members
                        and int(snapshot.get("mlsEpoch") or 0)
                        > removed_epoch
                    )
                    else None
                ),
                "Bob rejoin and MLS epoch recovery",
                timeout_seconds=STEP_TIMEOUT,
            )
            charlie_rejoined = self.runtime.wait_until(
                lambda: (
                    snapshot
                    if (
                        isinstance(
                            snapshot := self.runtime.conversation_snapshot(
                                charlie_id,
                                group_id,
                                kind="group",
                            ),
                            Mapping,
                        )
                        and set(snapshot.get("memberPtids", ()))
                        == expected_members
                        and int(snapshot.get("mlsEpoch") or 0)
                        >= int(bob_rejoined.get("mlsEpoch") or 0)
                    )
                    else None
                ),
                "Charlie observes Bob rejoin",
                timeout_seconds=STEP_TIMEOUT,
            )
            self.assert_condition(
                "member_add_cross_client",
                set(charlie_rejoined.get("memberPtids", ()))
                == expected_members,
                compact_json(charlie_rejoined),
            )
            self.assert_condition(
                "rejoin_epoch_recovery",
                int(bob_rejoined.get("mlsEpoch") or 0) > removed_epoch,
                compact_json(bob_rejoined),
            )
            self.assert_condition(
                "mls_epoch_advance",
                (
                    int(charlie_rejoined.get("mlsEpoch") or 0)
                    > initial_epoch
                ),
            )

            rejoin_text = f"ccu-group-rejoin-{time.time_ns()}"
            rejoin_message_id = self.runtime.send_message(
                bob_id,
                group_id,
                rejoin_text,
                kind="group",
            )
            owner_message = self.runtime.wait_for_message(
                owner_id,
                group_id,
                rejoin_message_id,
                lambda value: value.get("plaintext") == rejoin_text,
                kind="group",
                timeout_seconds=STEP_TIMEOUT,
                description="Desktop owner receives rejoined Mobile message",
            )
            charlie_message = self.runtime.wait_for_message(
                charlie_id,
                group_id,
                rejoin_message_id,
                lambda value: value.get("plaintext") == rejoin_text,
                kind="group",
                timeout_seconds=STEP_TIMEOUT,
                description="Mobile peer receives rejoined Mobile message",
            )
            owner_group = self.runtime.conversation_snapshot(
                owner_id,
                group_id,
                kind="group",
            )
            self.assert_condition(
                "group_message_encrypted_delivery",
                (
                    owner_message.get("messageId") == rejoin_message_id
                    and charlie_message.get("messageId") == rejoin_message_id
                    and isinstance(owner_group, Mapping)
                    and owner_group.get("securityState") == "ready"
                ),
                compact_json(owner_group),
            )

            owner_session = self.runtime.desktop_session(owner_id)
            if owner_session is not None:
                self.save_screenshot(owner_session, owner_id)
                self.save_dom(owner_session, owner_id)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Mixed-client Group MLS",
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
                "Mixed-client Group MLS cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "groupConversationId": group_id,
            "initialMlsEpoch": initial_epoch,
            "removedMlsEpoch": removed_epoch,
            "rejoinedMlsEpoch": int(bob_rejoined.get("mlsEpoch") or 0),
            "cleanup": cleanup,
        }


def main() -> int:
    return MixedClientGroupMlsGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
