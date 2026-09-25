#!/usr/bin/env python3
"""Native Desktop and Mobile Station Access authentication proof."""

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


GATE_ID = "station-access-auth-e2e"
STEP_TIMEOUT = float(
    os.environ.get("STATION_ACCESS_STEP_TIMEOUT_SECONDS", "120")
)
REQUIRED_ASSERTIONS = frozenset(
    {
        "signed_station_bound_before_credentials",
        "canonical_access_grants_same_actor_scope",
        "desktop_mobile_device_scope_isolated",
        "desktop_native_restart_preserves_scope",
        "mobile_native_restart_preserves_scope",
        "source_bound_native_cells",
    }
)


class StationAccessAuthGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-01"
    bom = ("SAL-G01", "SAL-G02")
    spec = ("SAL-J01", "SAL-J02", "SAL-C01", "SAL-C02", "SAL-C03")
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
                "journey": "station-access-authentication",
                "cleanup": {},
            }
        )

    def run(self) -> dict[str, Any]:
        desktop_id = "desktop-bob"
        mobile_id = "sim-ios"
        cleanup: dict[str, Any] = {}
        try:
            desktop = self.runtime.start_client(
                desktop_id,
                window_slot=0,
                window_count=1,
            )
            mobile = self.runtime.start_client(
                mobile_id,
                window_slot=0,
                window_count=1,
            )
            desktop_access = self.runtime.access_snapshot(desktop_id)
            mobile_access = self.runtime.access_snapshot(mobile_id)
            desktop_pre_auth = self._mapping(
                desktop_access.get("preAuthentication"),
                "Desktop pre-authentication state",
            )
            mobile_pre_auth = self._mapping(
                mobile_access.get("preAuthentication"),
                "Mobile pre-authentication scope",
            )
            self.assert_condition(
                "signed_station_bound_before_credentials",
                (
                    bool(desktop_access.get("bindingProofRefs"))
                    and bool(mobile_access.get("bindingProofRefs"))
                    and desktop_pre_auth.get("authenticated") is False
                    and not desktop_pre_auth.get("actorPtid")
                    and mobile_pre_auth.get("activeStationPeerId")
                    == mobile.station_peer_id
                    and mobile_pre_auth.get("activeActorPtid") is None
                    and mobile_pre_auth.get("runtimeStationPeerId") is None
                ),
                json.dumps(
                    {
                        "desktop": desktop_access,
                        "mobile": mobile_access,
                    },
                    sort_keys=True,
                ),
            )

            desktop_scope = self.runtime.scope_snapshot(desktop_id)
            mobile_scope = self.runtime.scope_snapshot(mobile_id)
            self.assert_condition(
                "canonical_access_grants_same_actor_scope",
                (
                    desktop.station_service_id
                    == mobile.station_service_id
                    and desktop.station_peer_id == mobile.station_peer_id
                    and desktop.ptid == mobile.ptid
                    and desktop_scope.get("authenticated") is True
                    and desktop_scope.get("actorPtid") == desktop.ptid
                    and mobile_scope.get("phase") == "ACTIVE"
                    and mobile_scope.get("launchState") == "shell"
                    and mobile_scope.get("actorPtid") == mobile.ptid
                    and mobile_scope.get("runtimeStationPeerId")
                    == mobile.station_peer_id
                ),
                json.dumps(
                    {
                        "desktop": desktop_scope,
                        "mobile": mobile_scope,
                    },
                    sort_keys=True,
                ),
            )
            self.assert_condition(
                "desktop_mobile_device_scope_isolated",
                (
                    bool(desktop.device_id)
                    and bool(mobile.device_id)
                    and desktop.device_id != mobile.device_id
                ),
            )

            desktop_restored = self.runtime.restart_desktop_session(
                desktop_id,
                window_slot=0,
                window_count=1,
                timeout_seconds=STEP_TIMEOUT,
            )
            self.assert_condition(
                "desktop_native_restart_preserves_scope",
                (
                    desktop_restored.get("authenticated") is True
                    and desktop_restored.get("stationPeerId")
                    == desktop.station_peer_id
                    and desktop_restored.get("actorPtid") == desktop.ptid
                    and desktop_restored.get("deviceIdentityDigest")
                    == desktop.device_id
                ),
                json.dumps(desktop_restored, sort_keys=True),
            )

            mobile_generation = mobile_scope.get("generation")
            self.runtime.restart_client(
                mobile_id,
                timeout_seconds=STEP_TIMEOUT,
            )
            mobile_restored = self.runtime.scope_snapshot(mobile_id)
            self.assert_condition(
                "mobile_native_restart_preserves_scope",
                (
                    isinstance(mobile_generation, int)
                    and isinstance(mobile_restored.get("generation"), int)
                    and mobile_restored["generation"] > mobile_generation
                    and mobile_restored.get("stationPeerId")
                    == mobile.station_peer_id
                    and mobile_restored.get("runtimeStationPeerId")
                    == mobile.station_peer_id
                    and mobile_restored.get("actorPtid") == mobile.ptid
                    and mobile_restored.get("deviceIdentityDigest")
                    == mobile.device_id
                ),
                json.dumps(mobile_restored, sort_keys=True),
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
                "Station Access authentication",
            )
            self.report.runtime["cleanup"] = cleanup

        assertions = {
            assertion.name for assertion in self.report.assertions
        }
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"Station Access assertions are missing: {sorted(missing)}"
            )
        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Station Access cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "stationServiceId": desktop.station_service_id,
            "stationPeerId": desktop.station_peer_id,
            "actorPtid": desktop.ptid,
            "desktopDeviceIdentityDigest": desktop.device_id,
            "mobileDeviceIdentityDigest": mobile.device_id,
            "cleanup": cleanup,
        }

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)


def main() -> int:
    return StationAccessAuthGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
