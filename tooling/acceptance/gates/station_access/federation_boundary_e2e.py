#!/usr/bin/env python3
"""Native Desktop and Mobile Federation context boundary proof."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError, REPO_ROOT
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
)
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)


GATE_ID = "station-access-federation-boundary-e2e"
STEP_TIMEOUT = float(
    os.environ.get("STATION_ACCESS_STEP_TIMEOUT_SECONDS", "120")
)
REQUIRED_ASSERTIONS = frozenset(
    {
        "desktop_explicit_federation_context",
        "mobile_explicit_federation_context",
        "desktop_scoped_catalog_search",
        "mobile_scoped_handle_resolve",
        "desktop_scoped_direct_creation",
        "mobile_scoped_group_creation",
        "wrong_context_rejected",
        "ordinary_client_governance_absent",
        "ordinary_client_relay_admin_absent",
        "source_bound_native_cells",
    }
)

CLIENT_BOUNDARY_CONTRACTS = {
    "apps/desktop/src/services/desktop_api.ts": {
        "pattern": r"^\s{2}(federation[A-Z][A-Za-z0-9]*):\s*\(",
        "allowed": {
            "federationResolve",
            "federationCatalogSearch",
            "federationListContexts",
        },
    },
    "apps/mobile/src/services/gateways/profileGateway.ts": {
        "pattern": (
            r"^\s{2}(listFederationContexts|"
            r"searchFederationActors|resolveFederationHandle):\s*\("
        ),
        "allowed": {
            "listFederationContexts",
            "searchFederationActors",
            "resolveFederationHandle",
        },
    },
    "apps/desktop/src-tauri/src/application/federation/mod.rs": {
        "pattern": r'^const (ROUTE_[A-Z_]+): &str = "',
        "allowed": {
            "ROUTE_RESOLVE",
            "ROUTE_CATALOG_SEARCH",
            "ROUTE_LIST_CONTEXTS",
        },
    },
    "apps/desktop/src-tauri/src/interface/tauri_commands/federation.rs": {
        "pattern": r"^\s*pub fn (federation_[a-z0-9_]+)\s*\(",
        "allowed": {
            "federation_resolve",
            "federation_catalog_search",
            "federation_list_contexts",
        },
    },
    "apps/desktop/src-tauri/src/main.rs": {
        "pattern": r"\bfederation::(federation_[a-z0-9_]+)\b",
        "allowed": {
            "federation_resolve",
            "federation_catalog_search",
            "federation_list_contexts",
        },
    },
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs": {
        "pattern": r'^\s*"(federation_[a-z0-9_]+)"\s*=>',
        "allowed": {
            "federation_resolve",
            "federation_catalog_search",
            "federation_list_contexts",
        },
    },
    "apps/mobile/src/services/gateways/gatewayTypes.ts": {
        "pattern": r"operationId:\s*'(federation_[a-z0-9_]+)'",
        "allowed": {
            "federation_contexts_list",
            "federation_resolve",
            "federation_catalog_search",
        },
    },
    "apps/mobile/src/services/stationTransport.ts": {
        "pattern": r"(?:operationId:\s*|case\s+)'(federation_[a-z0-9_]+)'",
        "allowed": {
            "federation_contexts_list",
            "federation_resolve",
            "federation_catalog_search",
        },
    },
}

CLIENT_BOUNDARY_ROOTS = (
    "apps/desktop/src",
    "apps/desktop/src-tauri/src",
    "apps/mobile/src",
    "apps/mobile/src-tauri/src",
)
CLIENT_BOUNDARY_SUFFIXES = frozenset({".rs", ".ts", ".tsx"})
CLIENT_BOUNDARY_SKIP_PARTS = frozenset(
    {"acceptance", "gen", "node_modules", "target"}
)
CLIENT_FEDERATION_COMMANDS = frozenset(
    {
        "federation_catalog_search",
        "federation_contexts_list",
        "federation_list_contexts",
        "federation_resolve",
    }
)
CLIENT_FEDERATION_ROUTES = frozenset(
    {
        "/actor/federation/profile",
        "/actor/federation/resolve",
        "/sub-federation/catalog/search",
        "/sub-federation/contexts",
    }
)
COMMAND_LITERAL_PATTERN = re.compile(
    r"""(?:\b(?:invoke[A-Za-z0-9_]*)"""
    r"""(?:<[^>]+>)?\(\s*|operationId:\s*|case\s+)"""
    r"""['"`]((?:federation|relay)_[a-z0-9_]+)['"`]"""
)
COMMAND_ASSIGNMENT_PATTERN = re.compile(
    r"""\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*"""
    r"""\s*=\s*['"`]((?:federation|relay)_[a-z0-9_]+)['"`]"""
)
ROUTE_LITERAL_PATTERN = re.compile(
    r"""['"`](/(?:(?:actor/)?federation|sub-federation|relay)/[^'"`\s]*)['"`]"""
)


def validate_ordinary_client_boundary(
    sources: Mapping[str, str] | None = None,
) -> dict[str, object]:
    inspected = (
        dict(sources)
        if sources is not None
        else _client_boundary_sources()
    )
    mismatches: dict[str, dict[str, list[str]]] = {}
    current_surfaces: dict[str, list[str]] = {}
    for path, contract in CLIENT_BOUNDARY_CONTRACTS.items():
        source = inspected.get(path)
        if source is None:
            mismatches[path] = {
                "expected": sorted(contract["allowed"]),
                "actual": [],
            }
            continue
        actual = set(re.findall(str(contract["pattern"]), source, re.MULTILINE))
        expected = set(contract["allowed"])
        current_surfaces[path] = sorted(actual)
        if actual != expected:
            mismatches[path] = {
                "expected": sorted(expected),
                "actual": sorted(actual),
            }
    if mismatches:
        raise GateError(
            "ordinary client Federation boundary must exactly match the "
            "current context surface: "
            + json.dumps(mismatches, sort_keys=True)
        )
    commands = {
        match
        for source in inspected.values()
        for pattern in (
            COMMAND_LITERAL_PATTERN,
            COMMAND_ASSIGNMENT_PATTERN,
        )
        for match in pattern.findall(source)
    }
    routes = {
        match
        for source in inspected.values()
        for match in ROUTE_LITERAL_PATTERN.findall(source)
    }
    if commands != CLIENT_FEDERATION_COMMANDS:
        raise GateError(
            "ordinary client Federation command inventory must exactly match "
            "the current context surface: "
            + json.dumps(
                {
                    "expected": sorted(CLIENT_FEDERATION_COMMANDS),
                    "actual": sorted(commands),
                },
                sort_keys=True,
            )
        )
    if routes != CLIENT_FEDERATION_ROUTES:
        raise GateError(
            "ordinary client Federation route inventory must exactly match "
            "the current context surface: "
            + json.dumps(
                {
                    "expected": sorted(CLIENT_FEDERATION_ROUTES),
                    "actual": sorted(routes),
                },
                sort_keys=True,
            )
        )
    return {
        "contractFiles": sorted(inspected),
        "currentSurfaces": current_surfaces,
        "contextCapabilitiesComplete": True,
        "operatorBoundary": "station-only",
        "relayBoundary": (
            "diagnostic-only"
            if not any(
                value.startswith("relay_") for value in commands
            )
            and not any(route.startswith("/relay/") for route in routes)
            else "client-surface-present"
        ),
    }


class StationAccessFederationBoundaryGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-02"
    bom = ("SAL-G03",)
    spec = ("SAL-J04", "SAL-J05", "SAL-C04", "SAL-C05")
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
                "journey": "station-access-federation-boundary",
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
                self.report.add_actor(self.runtime.actor_runtime(client_id))

            desktop = self.runtime.identities[desktop_id]
            mobile = self.runtime.identities[mobile_id]

            desktop_context = self._mapping(
                self.runtime.call_action(
                    desktop_id,
                    "federationContext",
                    {},
                ),
                "Desktop Federation context",
            )
            mobile_context = self._wait_for_mapping_action(
                mobile_id,
                "federation.context.read",
                {},
                "Mobile Federation context",
            )
            desktop_context_ids = self._context_ids(desktop_context)
            mobile_context_ids = self._context_ids(mobile_context)
            shared_context_ids = (
                desktop_context_ids & mobile_context_ids
            )
            if not shared_context_ids:
                raise GateError(
                    "Station Access proof requires an explicit shared active "
                    "Federation context"
                )
            expected_context = sorted(shared_context_ids)[0]
            self.assert_condition(
                "desktop_explicit_federation_context",
                (
                    expected_context in desktop_context_ids
                    and desktop_context_ids == mobile_context_ids
                ),
                json.dumps(desktop_context, sort_keys=True),
            )
            self.assert_condition(
                "mobile_explicit_federation_context",
                (
                    expected_context in mobile_context_ids
                    and desktop_context_ids == mobile_context_ids
                ),
                json.dumps(mobile_context, sort_keys=True),
            )

            mobile_fixture = self.runtime.actor_fixture(mobile_id)
            desktop_fixture = self.runtime.actor_fixture(desktop_id)
            wrong_context = f"{expected_context}-outside"
            wrong_context_rejected = False
            try:
                self.runtime.call_action(
                    mobile_id,
                    "social.people.search",
                    {
                        "query": self._required_text(
                            desktop_fixture.get("federatedHandle"),
                            "Desktop federated handle",
                        ),
                        "federationId": wrong_context,
                    },
                )
            except GateError:
                wrong_context_rejected = True
            self.assert_condition(
                "wrong_context_rejected",
                wrong_context_rejected,
                wrong_context,
            )

            desktop_search = self._mapping(
                self.runtime.call_action(
                    desktop_id,
                    "searchFederationContext",
                    {
                        "federationId": expected_context,
                        "prefix": self._handle_local_part(
                            mobile_fixture.get("federatedHandle")
                        ),
                    },
                ),
                "Desktop scoped Federation search",
            )
            desktop_entries = self._sequence(
                desktop_search.get("entries"),
                "Desktop scoped Federation search entries",
            )
            self.assert_condition(
                "desktop_scoped_catalog_search",
                self._contains_actor(
                    desktop_entries,
                    actor_key="actorPtid",
                    actor_ptid=mobile.ptid,
                    federation_id=expected_context,
                ),
                json.dumps(desktop_search, sort_keys=True),
            )

            mobile_search = self._mapping(
                self.runtime.call_action(
                    mobile_id,
                    "social.people.search",
                    {
                        "query": self._required_text(
                            desktop_fixture.get("federatedHandle"),
                            "Desktop federated handle",
                        ),
                        "federationId": expected_context,
                    },
                ),
                "Mobile scoped Federation search",
            )
            mobile_resolve = self._sequence(
                mobile_search.get("entries"),
                "Mobile scoped Federation search entries",
            )
            self.assert_condition(
                "mobile_scoped_handle_resolve",
                self._contains_actor(
                    mobile_resolve,
                    actor_key="ptid",
                    actor_ptid=desktop.ptid,
                    federation_id=expected_context,
                ),
                json.dumps(mobile_resolve, sort_keys=True),
            )

            direct_id = self.runtime.create_direct(
                desktop_id,
                mobile_id,
                federation_id=expected_context,
                timeout_seconds=STEP_TIMEOUT,
            )
            self.assert_condition(
                "desktop_scoped_direct_creation",
                bool(direct_id),
            )
            group_id = self.runtime.create_group(
                mobile_id,
                (desktop_id,),
                federation_id=expected_context,
                name="Station Access Federation Context",
                timeout_seconds=STEP_TIMEOUT,
            )
            self.assert_condition(
                "mobile_scoped_group_creation",
                bool(group_id) and group_id != direct_id,
            )

            boundary = validate_ordinary_client_boundary()
            self.assert_condition(
                "ordinary_client_governance_absent",
                (
                    boundary["contextCapabilitiesComplete"] is True
                    and boundary["operatorBoundary"] == "station-only"
                ),
            )
            self.assert_condition(
                "ordinary_client_relay_admin_absent",
                boundary["relayBoundary"] == "diagnostic-only",
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
                "Station Access Federation boundary",
            )
            self.report.runtime["cleanup"] = cleanup

        assertions = {
            assertion.name for assertion in self.report.assertions
        }
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                "Station Access Federation assertions are missing: "
                f"{sorted(missing)}"
            )
        if cleanup.get("cleanupErrors"):
            raise GateError(
                "Station Access Federation cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return {
            "sourceIdentity": source_identity,
            "stationPeerId": desktop.station_peer_id,
            "federationId": expected_context,
            "desktopActorPtid": desktop.ptid,
            "mobileActorPtid": mobile.ptid,
            "directConversationId": direct_id,
            "groupConversationId": group_id,
            "clientBoundary": boundary,
            "cleanup": cleanup,
            "proven_scope": [
                "Desktop and Mobile explicit Federation context",
                "Desktop scoped catalog search",
                "Mobile scoped handle resolve",
                "Desktop Direct and Mobile Group creation with explicit context",
                "ordinary-client Federation governance and Relay controls absent",
            ],
            "unproven_scope": [
                "Linux, Windows, Android, and physical-device behavior",
                "cross-Station delivery remains covered by Chat and Federation Gates",
            ],
        }

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    def _wait_for_mapping_action(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any],
        label: str,
    ) -> dict[str, Any]:
        def attempt() -> dict[str, Any] | None:
            try:
                value = self.runtime.call_action(
                    client_id,
                    action,
                    payload,
                )
            except Exception as error:
                if "mobile.social.runtimeUnavailable" in str(error):
                    return None
                raise
            return self._mapping(value, label)

        return self.runtime.wait_until(
            attempt,
            label,
            timeout_seconds=STEP_TIMEOUT,
        )

    @staticmethod
    def _sequence(value: object, label: str) -> list[object]:
        if not isinstance(value, list):
            raise GateError(f"{label} must be an array")
        return value

    @classmethod
    def _context_ids(cls, value: Mapping[str, Any]) -> set[str]:
        contexts = cls._sequence(
            value.get("federations"),
            "Federation contexts",
        )
        context_ids = {
            str(context.get("federationId") or "").strip()
            for context in contexts
            if (
                isinstance(context, Mapping)
                and context.get("status") == "active"
            )
        }
        if not context_ids or "" in context_ids:
            raise GateError("Federation contexts must have explicit identities")
        return context_ids

    @staticmethod
    def _contains_actor(
        entries: list[object],
        *,
        actor_key: str,
        actor_ptid: str,
        federation_id: str,
    ) -> bool:
        return any(
            isinstance(entry, Mapping)
            and entry.get(actor_key) == actor_ptid
            and entry.get("federationId") == federation_id
            for entry in entries
        )

    @classmethod
    def _handle_local_part(cls, value: object) -> str:
        handle = cls._required_text(value, "Federated handle")
        parts = handle.split("@")
        if len(parts) != 3 or parts[0] or not parts[1] or not parts[2]:
            raise GateError("Federated handle must use @user@host")
        return parts[1]

    @staticmethod
    def _required_text(value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be a non-empty string")
        return value.strip()


def _client_boundary_sources() -> dict[str, str]:
    sources: dict[str, str] = {}
    for relative_root in CLIENT_BOUNDARY_ROOTS:
        root = REPO_ROOT / relative_root
        for path in root.rglob("*"):
            relative = path.relative_to(REPO_ROOT)
            if (
                path.is_file()
                and path.suffix in CLIENT_BOUNDARY_SUFFIXES
                and not (set(relative.parts) & CLIENT_BOUNDARY_SKIP_PARTS)
                and ".test." not in path.name
                and ".spec." not in path.name
            ):
                sources[relative.as_posix()] = path.read_text(encoding="utf-8")
    return sources


def main() -> int:
    return StationAccessFederationBoundaryGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
