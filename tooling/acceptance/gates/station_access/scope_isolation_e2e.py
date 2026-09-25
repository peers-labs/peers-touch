#!/usr/bin/env python3
"""Native Desktop and Mobile Station Access scope-isolation proof."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError, REPO_ROOT
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
)
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)


GATE_ID = "station-access-scope-isolation-e2e"
STEP_TIMEOUT = float(
    os.environ.get("STATION_ACCESS_STEP_TIMEOUT_SECONDS", "120")
)
REQUIRED_ASSERTIONS = frozenset(
    {
        "same_actor_cross_platform_scope",
        "desktop_mobile_device_scope_isolated",
        "desktop_restart_preserves_scope",
        "mobile_restart_preserves_scope",
        "mobile_logout_clears_scope",
        "isolated_second_actor_scope",
        "source_bound_native_cells",
    }
)


class StationAccessScopeIsolationGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-01"
    bom = ("SAL-G02",)
    spec = ("SAL-J02", "SAL-J03", "SAL-C03")
    report_path = (
        REPO_ROOT
        / "tooling"
        / "acceptance"
        / "reports"
        / f"{GATE_ID}.json"
    )

    evidence_dir = report_path.parent / f"{GATE_ID}-evidence"

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
                "environment": "station-access-native",
                "runtimeCell": "desktop-macos-native+ios-simulator",
                "journey": "station-access-scope-isolation",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        desktop_bob_id = "desktop-bob"
        mobile_bob_id = "sim-ios"
        desktop_alice_id = "desktop-alice"
        mobile_alice_id = "sim-ios-peer"
        cleanup: dict[str, Any] = {}
        try:
            desktop_bob = self.runtime.start_client(
                desktop_bob_id,
                window_slot=0,
                window_count=2,
            )
            mobile_bob = self.runtime.start_client(
                mobile_bob_id,
                window_slot=0,
                window_count=1,
            )
            desktop_bob_scope = self.runtime.scope_snapshot(
                desktop_bob_id
            )
            mobile_bob_scope = self.runtime.scope_snapshot(mobile_bob_id)
            self.assert_condition(
                "same_actor_cross_platform_scope",
                (
                    desktop_bob.station_peer_id
                    == mobile_bob.station_peer_id
                    and desktop_bob.ptid == mobile_bob.ptid
                    and desktop_bob_scope.get("actorPtid")
                    == desktop_bob.ptid
                    and mobile_bob_scope.get("actorPtid") == mobile_bob.ptid
                ),
            )
            self.assert_condition(
                "desktop_mobile_device_scope_isolated",
                desktop_bob.device_id != mobile_bob.device_id,
            )

            desktop_restored = self.runtime.restart_desktop_session(
                desktop_bob_id,
                window_slot=0,
                window_count=2,
                timeout_seconds=STEP_TIMEOUT,
            )
            self.assert_condition(
                "desktop_restart_preserves_scope",
                (
                    desktop_restored.get("authenticated") is True
                    and desktop_restored.get("stationPeerId")
                    == desktop_bob.station_peer_id
                    and desktop_restored.get("actorPtid") == desktop_bob.ptid
                    and desktop_restored.get("deviceIdentityDigest")
                    == desktop_bob.device_id
                ),
                json.dumps(desktop_restored, sort_keys=True),
            )

            mobile_generation = mobile_bob_scope.get("generation")
            self.runtime.restart_client(
                mobile_bob_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            mobile_restored = self.runtime.scope_snapshot(mobile_bob_id)
            self.assert_condition(
                "mobile_restart_preserves_scope",
                (
                    isinstance(mobile_generation, int)
                    and isinstance(mobile_restored.get("generation"), int)
                    and mobile_restored["generation"] > mobile_generation
                    and mobile_restored.get("stationPeerId")
                    == mobile_bob.station_peer_id
                    and mobile_restored.get("runtimeStationPeerId")
                    == mobile_bob.station_peer_id
                    and mobile_restored.get("actorPtid") == mobile_bob.ptid
                    and mobile_restored.get("deviceIdentityDigest")
                    == mobile_bob.device_id
                ),
                json.dumps(mobile_restored, sort_keys=True),
            )

            logout = self._mapping(
                self.runtime.call_action(
                    mobile_bob_id,
                    "session.logout",
                    {"draftDisposition": "discard"},
                ),
                "Mobile logout result",
            )
            cleared = self.runtime.scope_snapshot(mobile_bob_id)
            social = self._mapping(
                cleared.get("social"),
                "Mobile cleared social scope",
            )
            self.assert_condition(
                "mobile_logout_clears_scope",
                (
                    logout.get("decision")
                    and cleared.get("stationPeerId")
                    == mobile_bob.station_peer_id
                    and cleared.get("actorPtid") is None
                    and cleared.get("runtimeStationPeerId") is None
                    and social.get("stationPeerId") is None
                    and social.get("actorPtid") is None
                    and social.get("sessionCount") == 0
                    and social.get("requestCount") == 0
                    and social.get("messageThreadCount") == 0
                ),
                json.dumps(cleared, sort_keys=True),
            )

            desktop_alice = self.runtime.start_client(
                desktop_alice_id,
                window_slot=1,
                window_count=2,
            )
            mobile_alice = self.runtime.start_client(
                mobile_alice_id,
                window_slot=0,
                window_count=1,
            )
            desktop_alice_scope = self.runtime.scope_snapshot(
                desktop_alice_id
            )
            mobile_alice_scope = self.runtime.scope_snapshot(
                mobile_alice_id
            )
            self.assert_condition(
                "isolated_second_actor_scope",
                (
                    desktop_alice.ptid == mobile_alice.ptid
                    and desktop_alice.ptid != desktop_bob.ptid
                    and desktop_alice.station_peer_id
                    == desktop_bob.station_peer_id
                    and desktop_alice_scope.get("actorPtid")
                    == desktop_alice.ptid
                    and mobile_alice_scope.get("actorPtid")
                    == mobile_alice.ptid
                    and len(
                        {
                            desktop_bob.device_id,
                            mobile_bob.device_id,
                            desktop_alice.device_id,
                            mobile_alice.device_id,
                        }
                    )
                    == 4
                ),
                json.dumps(
                    {
                        "desktopAlice": desktop_alice_scope,
                        "mobileAlice": mobile_alice_scope,
                    },
                    sort_keys=True,
                ),
            )

            source_identity = self.runtime.source_identity()
            self.assert_condition(
                "source_bound_native_cells",
                (
                    source_identity.get("desktopRuntimeCell", {}).get("cellId")
                    == "desktop-macos-native"
                    and source_identity.get("mobileRuntimeCell")
                    == "ios-simulator"
                    and source_identity.get("orchestrator", {}).get(
                        "workspaceDigest"
                    )
                    == "clean"
                ),
                json.dumps(source_identity, sort_keys=True),
            )

            for client_id in (desktop_bob_id, desktop_alice_id):
                session = self.runtime.desktop_session(client_id)
                if session is not None:
                    self.save_screenshot(session, client_id)
                    self.save_dom(session, client_id)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                lambda: self.runtime.cleanup(
                    save_desktop_log=self.save_app_log
                ),
                self.report,
                "Station Access scope isolation",
            )
            self.report.runtime["cleanup"] = cleanup

        assertions = {
            assertion.name for assertion in self.report.assertions
        }
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"Station Access scope assertions are missing: {sorted(missing)}"
            )
        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Station Access scope cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "stationPeerId": desktop_bob.station_peer_id,
            "bobActorPtid": desktop_bob.ptid,
            "aliceActorPtid": desktop_alice.ptid,
            "mobileLogout": logout,
            "cleanup": cleanup,
            "proven_scope": [
                "Desktop and Mobile same-actor Station scope",
                "Desktop and Mobile native restart scope",
                "Mobile logout old-scope absence",
                "second-actor native client isolation",
            ],
            "unproven_scope": [
                "Android and physical-device lifecycle behavior",
                "cross-Station context is proven by SAL-02",
            ],
        }

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)


def main() -> int:
    return StationAccessScopeIsolationGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
