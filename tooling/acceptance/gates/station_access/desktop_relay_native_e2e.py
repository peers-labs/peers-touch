#!/usr/bin/env python3
"""Prove station-keyed Relay binding in installed Desktop runtimes."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    call_async_harness,
    load_runtime_manifest,
)
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession


MACOS_GATE_ID = "station-access-desktop-relay-native-e2e"
WINDOWS_GATE_ID = "station-access-desktop-relay-windows-e2e"
CLIENT_ID = "desktop-relay"
ENVIRONMENT_ID = "station-access-relay-role"
GATE_RUNTIME_CELLS = {
    MACOS_GATE_ID: "desktop-macos-native",
    WINDOWS_GATE_ID: "desktop-windows-native",
}
REQUIRED_ASSERTIONS = frozenset(
    {
        "relay_service_preserves_station_identity",
        "relay_route_is_active",
        "relay_route_is_visible_in_native_ui",
        "direct_route_preserves_station_scope",
        "relay_route_reselection_preserves_station_scope",
        "route_switch_preserves_identity_state",
        "relay_binding_recovers_after_restart",
        "native_runtime_is_source_bound",
        "native_runtime_cleanup",
    }
)


def expected_runtime_cell(gate_id: str) -> str:
    try:
        return GATE_RUNTIME_CELLS[gate_id]
    except KeyError as error:
        raise GateError(f"unsupported Desktop Relay Gate: {gate_id}") from error


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{label} must be an object")
    return dict(value)


def is_relay_transport(locator: str, transport: object) -> bool:
    locator_url = urlsplit(locator)
    transport_url = urlsplit(str(transport or ""))
    return (
        transport_url.scheme == "https"
        and bool(transport_url.hostname)
        and transport_url.hostname == locator_url.hostname
        and transport_url.port is not None
    )


def station_registry_snapshot(session: TauriSession) -> dict[str, Any]:
    result = session.invoke_app_result("station_list")
    data = result.get("data") if isinstance(result, Mapping) else None
    status = data.get("status") if isinstance(data, Mapping) else None
    if not isinstance(status, str):
        raise GateError("station_list omitted its registry status")
    try:
        registry = json.loads(status)
    except json.JSONDecodeError as error:
        raise GateError("station_list returned invalid registry status") from error
    registry = _mapping(registry, "Station registry")
    active_peer_id = str(
        registry.get("active_station_peer_id") or ""
    ).strip()
    entries = registry.get("entries")
    if not active_peer_id or not isinstance(entries, list):
        raise GateError("Station registry has no active Station")
    active_entries = [
        entry
        for entry in entries
        if isinstance(entry, Mapping)
        and entry.get("station_peer_id") == active_peer_id
    ]
    if len(active_entries) != 1:
        raise GateError("Station registry active identity is ambiguous")
    entry = dict(active_entries[0])
    active_route_id = str(entry.get("active_route_id") or "").strip()
    routes = entry.get("routes")
    if not active_route_id or not isinstance(routes, list):
        raise GateError("Station registry has no active route")
    active_routes = [
        route
        for route in routes
        if isinstance(route, Mapping)
        and route.get("route_id") == active_route_id
    ]
    if len(active_routes) != 1:
        raise GateError("Station registry active route is ambiguous")
    return {
        "stationPeerId": active_peer_id,
        "activeRouteId": active_route_id,
        "routeRevision": int(entry.get("route_revision") or 0),
        "lifecycleGeneration": int(
            entry.get("lifecycle_generation") or 0
        ),
        "route": dict(active_routes[0]),
        "binding": _mapping(registry.get("binding"), "Station binding"),
    }


class DesktopRelayNativeGate(AcceptanceGate):
    phase = "SAL-REL-05"
    bom = ("SAL-REL-05-DESKTOP-BINDING",)
    spec = ("SAL-J01", "SAL-J02", "SAL-J03", "SAL-J06", "SAL-J07", "SAL-J09")

    def __init__(self, gate_id: str) -> None:
        self.gate_id = gate_id
        self.runtime_cell_id = expected_runtime_cell(gate_id)
        super().__init__()
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.manifest = load_runtime_manifest(Path(manifest_path), gate_id)
        if self.manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "Desktop Relay proof requires station-access-relay-role"
            )
        source = _mapping(self.manifest.get("source"), "runtime source")
        source_commit = str(source.get("commit") or "")
        if source.get("workspaceDigest") != "clean" or not source_commit:
            raise GateError("Desktop Relay proof requires clean exact source")
        selected_cell = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL",
            "",
        ).strip()
        if selected_cell != self.runtime_cell_id:
            raise GateError(
                f"{gate_id} requires {self.runtime_cell_id}, got "
                f"{selected_cell or '<none>'}"
            )
        self.client = self._client()
        self.services = self._services()
        self.runtime_binding = resolve_native_desktop_runtime(
            selected_cell,
            gate_id=gate_id,
            source_commit=source_commit,
        )
        self.runtime_binding.set_runtime_manifest(self.manifest)
        self.report.manifest = self.manifest

    def _client(self) -> dict[str, Any]:
        clients = self.manifest.get("clients")
        matches = [
            dict(client)
            for client in clients
            if isinstance(client, Mapping) and client.get("id") == CLIENT_ID
        ] if isinstance(clients, list) else []
        if (
            len(matches) != 1
            or matches[0].get("runtime") != "native-tauri"
        ):
            raise GateError(
                "Desktop Relay proof requires one Native Tauri client"
            )
        return matches[0]

    def _services(self) -> dict[str, dict[str, Any]]:
        services = _mapping(self.manifest.get("services"), "runtime services")
        required = {"station", "relay", "station-via-relay"}
        if set(services) < required:
            raise GateError("Desktop Relay proof has incomplete service topology")
        return {
            service_id: _mapping(services[service_id], service_id)
            for service_id in required
        }

    @staticmethod
    def _identity_state(session: TauriSession) -> dict[str, Any]:
        return _mapping(
            call_async_harness(
                session,
                "identityState",
                {},
                namespace="stationAccess",
                script_timeout=15,
            ),
            "Desktop identity state",
        )

    @staticmethod
    def _configure_route(
        session: TauriSession,
        endpoint: str,
    ) -> dict[str, Any]:
        return _mapping(
            call_async_harness(
                session,
                "configureStation",
                {"stationUrl": endpoint},
                namespace="stationAccess",
                script_timeout=30,
            ),
            "Desktop Station route configuration",
        )

    def _show_station_picker(self, session: TauriSession) -> dict[str, str]:
        session.find_element("[data-station-picker-trigger]", 30).click()
        station_row = session.find_element(
            (
                f'[data-station-peer-id="'
                f'{self.services["station"]["runtimeIdentity"]}"]'
            ),
            30,
        )
        selected_route = station_row.find_element(
            "css selector",
            '[data-station-route-type="relay"][aria-pressed="true"]',
        )
        return {
            "label": str(selected_route.text or "").strip(),
            "routeId": str(
                selected_route.get_attribute("data-station-route-id") or ""
            ),
            "routeType": str(
                selected_route.get_attribute("data-station-route-type") or ""
            ),
        }

    def run(self) -> dict[str, Any]:
        sessions: list[TauriSession] = []
        cleanup: dict[str, Any] = {}
        last_session: TauriSession | None = None
        station = self.services["station"]
        relay = self.services["relay"]
        station_via_relay = self.services["station-via-relay"]
        station_peer_id = str(station.get("runtimeIdentity") or "")
        direct_endpoint = str(station.get("endpoint") or "").rstrip("/")
        relay_endpoint = str(relay.get("endpoint") or "").rstrip("/")
        self.assert_condition(
            "relay_service_preserves_station_identity",
            bool(station_peer_id)
            and station_via_relay.get("runtimeIdentity") == station_peer_id
            and str(station_via_relay.get("endpoint") or "").rstrip("/")
            == relay_endpoint,
            json.dumps(self.services, sort_keys=True),
        )
        try:
            first = self.runtime_binding.create_bound_session(CLIENT_ID)
            sessions.append(first)
            last_session = first
            relay_initial = station_registry_snapshot(first)
            identity_initial = self._identity_state(first)
            self.assert_condition(
                "relay_route_is_active",
                relay_initial["stationPeerId"] == station_peer_id
                and relay_initial["route"].get("route_type") == "relay"
                and is_relay_transport(
                    relay_endpoint,
                    relay_initial["route"].get("endpoint_origin"),
                )
                and relay_initial["route"].get("health") == "available",
                json.dumps(relay_initial, sort_keys=True),
            )
            picker_state = self._show_station_picker(first)
            self.assert_condition(
                "relay_route_is_visible_in_native_ui",
                bool(picker_state["label"])
                and picker_state["routeType"] == "relay"
                and picker_state["routeId"]
                == relay_initial["activeRouteId"],
                json.dumps(picker_state, sort_keys=True),
            )
            self.save_screenshot(first, f"{self.runtime_cell_id}-via-relay")
            self.save_dom(first, f"{self.runtime_cell_id}-via-relay")

            direct_result = self._configure_route(first, direct_endpoint)
            direct = station_registry_snapshot(first)
            self.assert_condition(
                "direct_route_preserves_station_scope",
                direct_result.get("configured") is True
                and direct["stationPeerId"] == station_peer_id
                and direct["route"].get("route_type") == "direct"
                and direct["activeRouteId"] != relay_initial["activeRouteId"]
                and direct["routeRevision"] > relay_initial["routeRevision"]
                and direct["lifecycleGeneration"]
                == relay_initial["lifecycleGeneration"],
                json.dumps(direct, sort_keys=True),
            )

            relay_result = self._configure_route(first, relay_endpoint)
            relay_reselected = station_registry_snapshot(first)
            identity_after_switch = self._identity_state(first)
            self.assert_condition(
                "relay_route_reselection_preserves_station_scope",
                relay_result.get("configured") is True
                and relay_reselected["stationPeerId"] == station_peer_id
                and relay_reselected["route"].get("route_type") == "relay"
                and relay_reselected["activeRouteId"]
                != direct["activeRouteId"]
                and relay_reselected["routeRevision"]
                > direct["routeRevision"]
                and relay_reselected["lifecycleGeneration"]
                == direct["lifecycleGeneration"],
                json.dumps(relay_reselected, sort_keys=True),
            )
            self.assert_condition(
                "route_switch_preserves_identity_state",
                identity_after_switch == identity_initial,
                json.dumps(
                    {
                        "before": identity_initial,
                        "after": identity_after_switch,
                    },
                    sort_keys=True,
                ),
            )

            first.stop()
            restored = self.runtime_binding.create_bound_session(
                CLIENT_ID,
                NativeLaunchOptions(restore_session=True),
            )
            sessions.append(restored)
            last_session = restored
            recovered = station_registry_snapshot(restored)
            self.assert_condition(
                "relay_binding_recovers_after_restart",
                recovered["stationPeerId"] == station_peer_id
                and recovered["activeRouteId"]
                == relay_reselected["activeRouteId"]
                and recovered["routeRevision"]
                == relay_reselected["routeRevision"]
                and recovered["route"].get("route_type") == "relay",
                json.dumps(recovered, sort_keys=True),
            )
            runtime_identity = self.runtime_binding.runtime_identity()
            binary_identity = self.runtime_binding.binary_identity()
            source = _mapping(self.manifest.get("source"), "runtime source")
            self.assert_condition(
                "native_runtime_is_source_bound",
                runtime_identity.get("cellId") == self.runtime_cell_id
                and binary_identity.get("sourceCommit")
                == source.get("commit"),
                json.dumps(
                    {
                        "runtime": runtime_identity,
                        "binary": binary_identity,
                    },
                    sort_keys=True,
                ),
            )
        finally:
            if last_session is not None:
                last_session.stop()
                self.save_app_log(last_session, "desktop-relay")
            cleanup = self.runtime_binding.finalize_cleanup(
                sessions,
                {CLIENT_ID: self.client},
            )
            self.report.runtime["cleanup"] = cleanup

        self.assert_condition(
            "native_runtime_cleanup",
            cleanup.get("portsReleased") is True
            and cleanup.get("processesReleased") is True
            and cleanup.get("storageReleased") is True
            and not cleanup.get("cleanupErrors"),
            json.dumps(cleanup, sort_keys=True),
        )
        assertions = {item.name for item in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"Desktop Relay assertions are missing: {sorted(missing)}"
            )
        return {
            "environment": ENVIRONMENT_ID,
            "runtimeCell": self.runtime_cell_id,
            "journey": "station-keyed-relay-binding",
            "stationPeerId": station_peer_id,
            "initialRelay": relay_initial,
            "direct": direct,
            "reselectedRelay": relay_reselected,
            "recoveredRelay": recovered,
            "cleanup": cleanup,
        }


def main() -> int:
    gate_id = os.environ.get("PT_ACCEPTANCE_GATE_ID", "").strip()
    return DesktopRelayNativeGate(gate_id).execute()


if __name__ == "__main__":
    raise SystemExit(main())
