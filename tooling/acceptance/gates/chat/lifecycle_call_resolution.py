#!/usr/bin/env python3
"""Prove multi-device call resolution: dual-ring first-terminal-action-wins,
handled-elsewhere, concurrent accept/reject across Desktop + Mobile.

Station implements call resolution in call_resolution.go with atomic
first-terminal-action-wins semantics and a 5-minute TTL. CallSignal proto
carries call_id (field 5) and winning_device_id (field 6). Station returns
HTTP 409 CALL_ALREADY_HANDLED on conflict. Call states are:
ringing_all_devices, active_here, handled_elsewhere.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Mapping

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
    runtime_station_service,
    wait_until,
)


GATE_ID = "chat-lifecycle-call-resolution-e2e"
REPORT_PATH = (
    REPO_ROOT / "tooling" / "acceptance" / "reports"
    / "chat-lifecycle-call-resolution-e2e.json"
)
CLIENTS = ("desktop-alice", "desktop-bob", "sim-ios")
STEP_TIMEOUT = float(
    os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120")
)
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "dual_ring_fan_out",
    "first_accept_wins",
    "loser_handled_elsewhere",
    "reject_before_accept",
    "duplicate_accept_409",
    "reconnect_after_resolution",
}

class CallResolutionGate(AcceptanceGate):
    """E2E gate proving multi-device call resolution semantics."""

    gate_id = GATE_ID
    phase = "CCU-W05"
    bom = ("CCU-G01", "CCU-G02", "CCU-G03")
    spec = (
        "call-resolution-first-terminal-action-wins",
        "call-resolution-handled-elsewhere",
        "call-resolution-concurrent-accept-reject",
    )
    report_path = REPORT_PATH
    evidence_dir = (
        REPORT_PATH.parent / "chat-lifecycle-call-resolution-evidence"
        if REPORT_PATH is not None
        else None
    )

    def __init__(
        self,
        *,
        runtime: MixedNativeRuntime | None = None,
    ) -> None:
        super().__init__()
        self.runtime = runtime or MixedNativeRuntime.from_environment(
            self.gate_id
        )
        self.manifest = self.runtime.manifest
        self.actor_manifest = self.runtime.actor_manifest
        self.runtime_binding = self.runtime.desktop_binding
        station = runtime_station_service(
            self.manifest,
            "desktop-alice",
        )
        source = self.manifest.get("source")
        self.station_url = str(station.get("endpoint") or "").rstrip("/")
        self.tested_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        self.client_specs = {
            str(client.get("id")): client
            for client in self.manifest.get("clients", [])
            if isinstance(client, dict)
        }
        if not set(CLIENTS).issubset(set(self.client_specs)):
            raise GateError(
                "runtime manifest must allocate Alice plus two isolated "
                "Bob device clients"
            )
        if not self.station_url:
            raise GateError("Call resolution gate Station URL is required")
        self.steps: list[dict[str, Any]] = []
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.report.station_url = self.station_url
        self.report.manifest = self.manifest
        self.report.runtime.update(
            {
                "runtimeCell": "desktop-macos-native+ios-simulator",
                "journey": "call-resolution-multi-device",
                "steps": self.steps,
                "cleanup": {},
            }
        )

    # -- Step instrumentation --------------------------------------------------

    def step(
        self,
        name: str,
        action: Callable[[], Any],
        client: str = "",
    ) -> Any:
        started = time.monotonic()
        try:
            value = action()
        except Exception as error:
            self.steps.append(
                {
                    "step": name,
                    "client": client,
                    "status": "fail",
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "error": str(error),
                }
            )
            raise
        self.steps.append(
            {
                "step": name,
                "client": client,
                "status": "pass",
                "durationMs": int((time.monotonic() - started) * 1000),
            }
        )
        return value

    # -- Client lifecycle ------------------------------------------------------

    def start_client(self, client_id: str) -> None:
        identity = self.runtime.start_client(
            client_id,
            window_slot=CLIENTS.index(client_id),
            window_count=len(CLIENTS),
        )
        self.ptids[client_id] = identity.ptid
        self.device_ids[client_id] = identity.device_id
        self.report.add_actor(self.runtime.actor_runtime(client_id))

    def verify_fixture_ready(self) -> bool:
        if self.manifest.get("state") != "FIXTURE_READY":
            raise GateError("Mixed Chat Fixture is not ready")
        return True

    def source_identity(self) -> dict[str, Any]:
        identity = self.runtime.source_identity()
        self.assert_condition(
            "source_build_runtime_identity",
            True,
            compact_json(identity),
        )
        self.report.runtime["sourceIdentity"] = identity
        return identity

    def cleanup_clients(self) -> dict[str, Any]:
        cleanup = self.runtime.cleanup(save_desktop_log=self.save_app_log)
        desktop = cleanup.get("desktop")
        cleanup_errors = cleanup.get("cleanupErrors")
        cleanup_passed = (
            cleanup.get("mobileSessionsReleased") is True
            and isinstance(desktop, Mapping)
            and desktop.get("portsReleased") is True
            and desktop.get("processesReleased") is True
            and desktop.get("storageReleased") is True
            and desktop.get("logsReleased") is True
            and not cleanup_errors
        )
        self.report.runtime["cleanup"] = cleanup
        if not cleanup_passed:
            raise GateError(
                "Call resolution cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return cleanup

    # -- Call resolution scenarios ---------------------------------------------

    def initiate_call(
        self,
        caller: str,
        callee_ptid: str,
    ) -> dict[str, Any]:
        """Ask the caller client to initiate a call signal to callee.

        Returns the call initiation evidence including call_id.
        """
        result = self.runtime.call_action(
            caller,
            "initiateCall",
            {
                "calleePtid": callee_ptid,
                "callerDeviceId": self.device_ids[caller],
            },
            timeout=30,
        )
        if not isinstance(result, dict) or not result.get("callId"):
            raise GateError(
                f"{caller} call initiation returned invalid evidence: "
                f"{result}"
            )
        return result

    def read_call_state(
        self,
        actor: str,
        call_id: str,
    ) -> dict[str, Any] | None:
        """Read call resolution state on a given actor's device.

        Returns a dict with callId, state (ringing_all_devices | active_here
        | handled_elsewhere), and winningDeviceId when resolved.
        """
        result = self.runtime.call_action(
            actor,
            "callResolutionState",
            {
                "callId": call_id,
                "deviceId": self.device_ids[actor],
            },
            timeout=10,
        )
        if not isinstance(result, dict):
            return None
        return result

    def accept_call(
        self,
        actor: str,
        call_id: str,
    ) -> dict[str, Any]:
        """Accept call on the specified actor's device.

        Returns the acceptance result. Station returns 409 on conflict.
        """
        result = self.runtime.call_action(
            actor,
            "acceptCall",
            {
                "callId": call_id,
                "deviceId": self.device_ids[actor],
            },
            timeout=30,
        )
        if not isinstance(result, dict):
            raise GateError(
                f"{actor} call accept returned invalid evidence: {result}"
            )
        return result

    def reject_call(
        self,
        actor: str,
        call_id: str,
    ) -> dict[str, Any]:
        """Reject call on the specified actor's device."""
        result = self.runtime.call_action(
            actor,
            "rejectCall",
            {
                "callId": call_id,
                "deviceId": self.device_ids[actor],
            },
            timeout=30,
        )
        if not isinstance(result, dict):
            raise GateError(
                f"{actor} call reject returned invalid evidence: {result}"
            )
        return result

    def prove_dual_ring_fan_out(
        self,
        call_id: str,
        desktop_actor: str,
        mobile_actor: str,
    ) -> dict[str, Any]:
        """Prove both desktop and mobile devices ring on incoming call."""

        def both_ringing() -> dict[str, Any] | None:
            desktop_state = self.read_call_state(desktop_actor, call_id)
            mobile_state = self.read_call_state(mobile_actor, call_id)
            if (
                isinstance(desktop_state, dict)
                and isinstance(mobile_state, dict)
                and desktop_state.get("state") == "ringing_all_devices"
                and mobile_state.get("state") == "ringing_all_devices"
            ):
                return {
                    "desktop": desktop_state,
                    "mobile": mobile_state,
                }
            return None

        evidence = wait_until(
            both_ringing,
            "dual-ring fan-out on both devices",
            STEP_TIMEOUT,
        )
        self.assert_condition(
            "dual_ring_fan_out",
            (
                evidence["desktop"]["state"] == "ringing_all_devices"
                and evidence["mobile"]["state"] == "ringing_all_devices"
            ),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def prove_first_accept_wins(
        self,
        call_id: str,
        winner_actor: str,
    ) -> dict[str, Any]:
        """Accept from the winner device and verify active_here."""
        acceptance = self.accept_call(winner_actor, call_id)
        state = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(
                            winner_actor, call_id
                        ),
                        dict,
                    )
                    and snapshot.get("state") == "active_here"
                )
                else None
            ),
            f"{winner_actor} active_here after first accept",
            STEP_TIMEOUT,
        )
        evidence = {
            "acceptance": acceptance,
            "resolvedState": state,
        }
        self.assert_condition(
            "first_accept_wins",
            (
                state.get("state") == "active_here"
                and state.get("winningDeviceIdentityDigest")
                == self.device_ids[winner_actor]
            ),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def prove_loser_handled_elsewhere(
        self,
        call_id: str,
        loser_actor: str,
        winner_device_id: str,
    ) -> dict[str, Any]:
        """Verify the losing device transitions to handled_elsewhere."""
        state = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(
                            loser_actor, call_id
                        ),
                        dict,
                    )
                    and snapshot.get("state") == "handled_elsewhere"
                )
                else None
            ),
            f"{loser_actor} handled_elsewhere after resolution",
            STEP_TIMEOUT,
        )
        evidence = {"resolvedState": state}
        self.assert_condition(
            "loser_handled_elsewhere",
            (
                state.get("state") == "handled_elsewhere"
                and state.get("winningDeviceIdentityDigest")
                == winner_device_id
            ),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def prove_reject_before_accept(
        self,
        caller: str,
        callee_ptid: str,
        reject_actor: str,
        accept_actor: str,
    ) -> dict[str, Any]:
        """Reject from one device, then prove a later accept cannot override it."""
        call = self.initiate_call(caller, callee_ptid)
        call_id = str(call["callId"])

        wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(
                            reject_actor, call_id
                        ),
                        dict,
                    )
                    and snapshot.get("state") == "ringing_all_devices"
                )
                else None
            ),
            f"{reject_actor} ringing before reject",
            STEP_TIMEOUT,
        )

        rejection = self.reject_call(reject_actor, call_id)
        acceptance = self.accept_call(accept_actor, call_id)

        reject_state = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(
                            reject_actor, call_id
                        ),
                        dict,
                    )
                    and snapshot.get("state") == "rejected"
                )
                else None
            ),
            f"{reject_actor} retains rejected result",
            STEP_TIMEOUT,
        )
        loser_state = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(
                            accept_actor, call_id
                        ),
                        dict,
                    )
                    and snapshot.get("state") == "handled_elsewhere"
                )
                else None
            ),
            f"{accept_actor} cannot override rejected result",
            STEP_TIMEOUT,
        )
        caller_state = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(caller, call_id),
                        dict,
                    )
                    and snapshot.get("state") == "rejected"
                )
                else None
            ),
            f"{caller} observes the rejected call",
            STEP_TIMEOUT,
        )

        evidence = {
            "callId": call_id,
            "rejection": rejection,
            "acceptance": acceptance,
            "rejectState": reject_state,
            "loserState": loser_state,
            "callerState": caller_state,
        }
        self.assert_condition(
            "reject_before_accept",
            (
                reject_state.get("state") == "rejected"
                and reject_state.get("winningDeviceIdentityDigest")
                == self.device_ids[reject_actor]
                and loser_state.get("state") == "handled_elsewhere"
                and caller_state.get("state") == "rejected"
                and acceptance.get("conflict") is True
            ),
            json.dumps(evidence, sort_keys=True),
        )
        self.assert_condition(
            "duplicate_accept_409",
            acceptance.get("conflict") is True,
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def prove_reconnect_after_resolution(
        self,
        call_id: str,
        actor: str,
        expected_state: str,
    ) -> dict[str, Any]:
        """Verify resolved call state survives a reconnection cycle."""
        self.runtime.reconnect_client(
            actor,
            timeout_seconds=STEP_TIMEOUT,
        )

        state = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self.read_call_state(actor, call_id),
                        dict,
                    )
                    and snapshot.get("state") == expected_state
                )
                else None
            ),
            f"{actor} retains {expected_state} after reconnect",
            STEP_TIMEOUT,
        )
        evidence = {"reconnectedState": state}
        self.assert_condition(
            "reconnect_after_resolution",
            state.get("state") == expected_state,
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    # -- Main gate execution ---------------------------------------------------

    def run(self) -> dict[str, Any]:
        source_identity: dict[str, Any] = {}
        self.step("fixture.reset", self.verify_fixture_ready)

        order = list(CLIENTS)
        cleanup: dict[str, Any] = {}
        try:
            # -- Authenticate all actors --
            for actor in order:
                self.step(
                    "client.authenticated",
                    lambda actor=actor: self.start_client(actor),
                    actor,
                )

            source_identity = self.step(
                "runtime.source_identity",
                self.source_identity,
            )
            self.assert_condition(
                "native_runtime",
                (
                    self.runtime.identities["desktop-alice"].runtime
                    == "desktop-macos-native"
                    and self.runtime.identities["desktop-bob"].runtime
                    == "desktop-macos-native"
                    and self.runtime.identities["sim-ios"].runtime
                    == "tauri-ios-simulator"
                ),
            )
            self.assert_condition(
                "actor_isolation",
                self.ptids["desktop-alice"] != self.ptids["desktop-bob"]
                and self.ptids["desktop-bob"] == self.ptids["sim-ios"]
                and len(set(self.device_ids.values())) == len(CLIENTS)
            )
            direct_conversation_id = self.step(
                "conversation.direct_ready",
                lambda: self.runtime.create_direct(
                    "desktop-alice",
                    "desktop-bob",
                    federation_id=self.runtime.identities[
                        "desktop-alice"
                    ].federation_id,
                    timeout_seconds=STEP_TIMEOUT,
                ),
            )
            self.report.runtime["directConversationId"] = (
                direct_conversation_id
            )

            # Resolve a rejection first so the caller can start a second call.
            self.step(
                "call.reject_before_accept",
                lambda: self.prove_reject_before_accept(
                    "desktop-alice",
                    self.ptids["desktop-bob"],
                    "sim-ios",
                    "desktop-bob",
                ),
            )

            # Alice calls Bob. Bob is active on Desktop and Mobile.
            call = self.step(
                "call.initiate",
                lambda: self.initiate_call(
                    "desktop-alice", self.ptids["desktop-bob"]
                ),
                "desktop-alice",
            )
            call_id = str(call["callId"])

            self.step(
                "call.dual_ring",
                lambda: self.prove_dual_ring_fan_out(
                    call_id, "desktop-bob", "sim-ios"
                ),
            )

            first_accept = self.step(
                "call.first_accept",
                lambda: self.prove_first_accept_wins(
                    call_id,
                    "desktop-bob",
                ),
                "desktop-bob",
            )
            winner_device_id = str(
                first_accept["resolvedState"].get(
                    "winningDeviceIdentityDigest"
                )
                or ""
            )

            self.step(
                "call.loser_handled_elsewhere",
                lambda: self.prove_loser_handled_elsewhere(
                    call_id, "sim-ios", winner_device_id
                ),
                "sim-ios",
            )

            self.step(
                "call.reconnect_loser",
                lambda: self.prove_reconnect_after_resolution(
                    call_id,
                    "sim-ios",
                    "handled_elsewhere",
                ),
                "sim-ios",
            )

            for actor in CLIENTS:
                client = self.runtime.desktop_session(actor)
                if client is None:
                    continue
                self.save_screenshot(client, actor)
                self.save_dom(client, actor)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                self.cleanup_clients,
                self.report,
                "Call resolution",
            )
            self.report.runtime["steps"] = self.steps

        assertion_names = {
            assertion.name for assertion in self.report.assertions
        }
        missing = REQUIRED_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"required assertions are missing: {sorted(missing)}"
            )
        return {
            "runtimeCell": (
                "desktop-macos-native+ios-simulator"
            ),
            "journey": "call-resolution-multi-device",
            "testedCommit": self.tested_commit,
            "sourceIdentity": source_identity,
            "launchOrder": order,
            "callId": call_id,
            "steps": self.steps,
            "cleanup": cleanup,
            "clients": {
                actor: {
                    "ptid": self.ptids[actor],
                    "deviceIdentityDigest": self.device_ids[actor],
                    "runtime": self.runtime.identities[actor].runtime,
                    "stationServiceId": (
                        self.runtime.identities[actor].station_service_id
                    ),
                }
                for actor in CLIENTS
            },
        }


def main() -> int:
    return CallResolutionGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
