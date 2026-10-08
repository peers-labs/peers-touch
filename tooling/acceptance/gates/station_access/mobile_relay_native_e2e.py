#!/usr/bin/env python3
"""Prove Station-keyed Relay routing in the exact-source iOS Simulator app."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    DriverError,
    EphemeralCapabilityBlocked,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    MobileSimulatorRuntimeBinding,
)


GATE_ID = "station-access-mobile-relay-native-e2e"
ENVIRONMENT_ID = "mobile-social-simulator"
CLIENT_ID = "sim-ios"
STATION_SERVICE_ID = "station-primary"
RELAY_SERVICE_ID = "relay"
REQUIRED_BUSINESS_RUNTIMES = frozenset(
    {"messaging", "chat-storage", "command", "social", "group"}
)


class MobileRelayNativeGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-06"
    bom = ("SAL-REL-06-MOBILE-BINDING",)
    spec = ("SAL-J01", "SAL-J02", "SAL-J06", "SAL-J07", "SAL-J09")

    def __init__(
        self,
        *,
        binding_factory: Callable[[], MobileSimulatorRuntimeBinding] | None = None,
    ) -> None:
        super().__init__()
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
        if self.manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "Mobile Relay proof requires mobile-social-simulator"
            )
        source = self._mapping(self.manifest.get("source"), "runtime source")
        if source.get("workspaceDigest") != "clean" or not source.get("commit"):
            raise GateError("Mobile Relay proof requires clean exact source")
        self.binding_factory = binding_factory or (
            lambda: MobileSimulatorRuntimeBinding.from_environment(
                gate_id=self.gate_id
            )
        )
        self.events: list[dict[str, Any]] = []
        self.cleanup: list[dict[str, Any]] = []
        self.client_active = False
        self.report.manifest = self.manifest

    def run(self) -> dict[str, Any]:
        raise GateError(
            "MobileRelayNativeGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(repo_root=REPO_ROOT, gate_id=self.gate_id) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result = self._result_base(status)
            binding: MobileSimulatorRuntimeBinding | None = None
            try:
                binding = self.binding_factory()
                result.update(self._run_journey(binding))
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except EphemeralCapabilityBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError) as error:
                result.update(
                    {
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
            except Exception as error:
                result.update(
                    {
                        "reason": (
                            "unexpected Mobile Relay Gate failure: "
                            f"{type(error).__name__}"
                        ),
                        "errorType": type(error).__name__,
                    }
                )
            finally:
                cleanup_error = self._cleanup(binding)

            if cleanup_error is not None:
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["cleanupReason"] = cleanup_error
                result.setdefault("reason", cleanup_error)
            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "cleanup": list(self.cleanup),
                }
            )
            artifacts.write_json(
                "mobile-relay/events.json",
                {
                    "artifactKind": "mobile-relay-events",
                    "gateId": self.gate_id,
                    "events": list(self.events),
                },
                role="mobile-relay-events",
            )
            artifacts.write_json(
                "mobile-relay/result.json",
                result,
                role="mobile-relay-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "runtimeCell": "ios-simulator",
                    "client": CLIENT_ID,
                    "physicalDeviceClaimed": False,
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _run_journey(
        self,
        binding: MobileSimulatorRuntimeBinding,
    ) -> dict[str, Any]:
        services = self._mapping(self.manifest.get("services"), "runtime services")
        station = self._mapping(
            services.get(STATION_SERVICE_ID),
            STATION_SERVICE_ID,
        )
        relay = self._mapping(
            services.get(RELAY_SERVICE_ID),
            RELAY_SERVICE_ID,
        )
        station_peer_id = self._required_text(
            station.get("runtimeIdentity"),
            "Station runtime identity",
        )
        relay_endpoint = self._required_text(
            relay.get("endpoint"),
            "Relay endpoint",
        )

        activation = binding.create_bound_session(CLIENT_ID)
        self.client_active = True
        if activation.active_binding_role != "station":
            raise GateError("Mobile Relay client did not launch on its Station binding")
        if activation.scope.get("activeStationPeerId") != station_peer_id:
            raise GateError("Mobile Relay client launched with the wrong Station identity")
        authentication = self._mapping(
            binding.authenticate_fixture_actor(CLIENT_ID),
            "fixture authentication",
        )
        login = self._mapping(authentication.get("login"), "fixture login")
        session = self._mapping(login.get("session"), "fixture session")
        actor_ptid = self._required_text(session.get("actorPtid"), "actor PTID")
        initial_scope = self._scope(binding)
        self._assert_session_scope(initial_scope, station_peer_id, actor_ptid)
        self._wait_business_runtimes(binding, "direct-login")
        self._read_profile(binding, actor_ptid, "direct-login")

        direct = self._route_snapshot(binding)
        direct_entry, direct_route = self._active_route(direct, station_peer_id)
        if direct_route.get("routeType") != "direct":
            raise GateError("Mobile did not begin on a Direct Station route")
        direct_route_id = self._required_text(
            direct_route.get("routeId"),
            "Direct route ID",
        )
        lifecycle_generation = self._positive_int(
            direct_entry.get("lifecycleGeneration"),
            "Station lifecycle generation",
        )
        direct_revision = self._positive_int(
            direct_entry.get("routeRevision"),
            "Direct route revision",
        )
        self._record("direct-route-ready", routeId=direct_route_id)

        added = binding.activate_station_route(CLIENT_ID, "relay")
        relay_entry, relay_route = self._active_route(added, station_peer_id)
        if relay_route.get("routeType") != "relay":
            raise GateError("Relay discovery did not activate a Relay route")
        relay_route_id = self._required_text(
            relay_route.get("routeId"),
            "Relay route ID",
        )
        relay_revision = self._positive_int(
            relay_entry.get("routeRevision"),
            "Relay route revision",
        )
        if relay_revision <= direct_revision:
            raise GateError("Relay route activation did not advance route revision")
        if self._positive_int(
            relay_entry.get("lifecycleGeneration"),
            "Relay lifecycle generation",
        ) != lifecycle_generation:
            raise GateError("Same-Station Relay activation changed lifecycle generation")
        self._assert_session_scope(self._scope(binding), station_peer_id, actor_ptid)
        self._wait_business_runtimes(binding, "relay-activation")
        self._read_profile(binding, actor_ptid, "relay-activation")
        relay_binding = self._mapping(
            added.get("binding"),
            "Relay binding",
        )
        if (
            relay_binding.get("routeType") != "relay"
            or relay_binding.get("stationPeerId") != station_peer_id
        ):
            raise GateError("Native Relay transport binding is not active")
        self._record(
            "relay-route-ready",
            routeId=relay_route_id,
            routeRevision=relay_revision,
        )

        restarted = binding.call_action(CLIENT_ID, "lifecycle.restart")
        if restarted != {"requested": True, "scope": "webview"}:
            raise GateError("Mobile lifecycle.restart response is invalid")
        self._wait_business_runtimes(binding, "relay-restart")
        restored_scope = self._wait_scope(
            binding,
            lambda scope: scope.get("activeActorPtid") == actor_ptid,
        )
        self._assert_session_scope(restored_scope, station_peer_id, actor_ptid)
        self._read_profile(binding, actor_ptid, "relay-restart")
        restored = self._route_snapshot(binding)
        restored_entry, restored_route = self._active_route(
            restored,
            station_peer_id,
        )
        if (
            restored_route.get("routeId") != relay_route_id
            or restored_route.get("routeType") != "relay"
            or self._positive_int(
                restored_entry.get("lifecycleGeneration"),
                "restored lifecycle generation",
            )
            != lifecycle_generation
        ):
            raise GateError("Mobile restart did not recover the Relay binding")
        self._record("relay-route-restored", routeId=relay_route_id)

        direct_selected = binding.activate_station_route(CLIENT_ID, "direct")
        if not isinstance(direct_selected.get("uiEvidence"), Mapping):
            raise GateError("Direct route selection has no native UI evidence")
        direct_entry, direct_route = self._active_route(
            direct_selected,
            station_peer_id,
        )
        if direct_route.get("routeType") != "direct":
            raise GateError("Explicit route selection did not activate Direct")
        self._assert_session_scope(self._scope(binding), station_peer_id, actor_ptid)
        self._read_profile(binding, actor_ptid, "direct-selection")

        relay_selected = binding.activate_station_route(CLIENT_ID, "relay")
        if not isinstance(relay_selected.get("uiEvidence"), Mapping):
            raise GateError("Relay route selection has no native UI evidence")
        final_entry, final_route = self._active_route(
            relay_selected,
            station_peer_id,
        )
        if final_route.get("routeType") != "relay":
            raise GateError("Explicit route selection did not restore Relay")
        if self._positive_int(
            final_entry.get("lifecycleGeneration"),
            "final lifecycle generation",
        ) != lifecycle_generation:
            raise GateError("Route switching changed Station lifecycle generation")
        final_scope = self._scope(binding)
        self._assert_session_scope(final_scope, station_peer_id, actor_ptid)
        self._read_profile(binding, actor_ptid, "relay-selection")
        self._record(
            "route-switch-preserved-session",
            directRouteId=direct_route_id,
            relayRouteId=relay_route_id,
            routeRevision=self._positive_int(
                final_entry.get("routeRevision"),
                "final route revision",
            ),
        )

        return {
            "stationPeerId": station_peer_id,
            "actorPtid": actor_ptid,
            "directRouteId": direct_route_id,
            "relayRouteId": relay_route_id,
            "routeRevision": final_entry.get("routeRevision"),
            "lifecycleGeneration": lifecycle_generation,
            "sessionPreserved": True,
            "restartRecovered": True,
            "businessReadOverRelay": True,
            "businessRuntimeContinuity": True,
            "observedScope": [
                "signed Relay discovery and Station route attestation",
                "Station-owned inner TLS identity over Relay",
                "same-Station Direct and Relay route switching",
                "Session and lifecycle generation preservation",
                "Relay route recovery after iOS WebView restart",
            ],
        }

    def _route_snapshot(
        self,
        binding: MobileSimulatorRuntimeBinding,
    ) -> dict[str, Any]:
        return self._mapping(
            binding.station_route_snapshot(CLIENT_ID),
            "Mobile route snapshot",
        )

    def _scope(
        self,
        binding: MobileSimulatorRuntimeBinding,
    ) -> dict[str, Any]:
        return self._mapping(
            binding.call_action(CLIENT_ID, "lifecycle.scope.read"),
            "Mobile lifecycle scope",
        )

    def _wait_business_runtimes(
        self,
        binding: MobileSimulatorRuntimeBinding,
        checkpoint: str,
    ) -> dict[str, Any]:
        snapshot = self._mapping(
            binding.call_action(CLIENT_ID, "lifecycle.waitReady", {}),
            f"{checkpoint} runtime readiness",
        )
        runtimes = snapshot.get("runtimes")
        if snapshot.get("phase") != "ACTIVE" or not isinstance(runtimes, list):
            raise GateError(f"{checkpoint} Mobile runtime graph is not active")
        statuses = {
            runtime.get("id"): runtime.get("status")
            for runtime in runtimes
            if isinstance(runtime, Mapping)
        }
        unavailable = sorted(
            runtime_id
            for runtime_id in REQUIRED_BUSINESS_RUNTIMES
            if statuses.get(runtime_id) != "ready"
        )
        if unavailable:
            raise GateError(
                f"{checkpoint} Mobile business runtimes are unavailable: "
                + ",".join(unavailable)
            )
        self._record(
            "business-runtimes-ready",
            checkpoint=checkpoint,
            runtimeIds=sorted(REQUIRED_BUSINESS_RUNTIMES),
        )
        return snapshot

    def _read_profile(
        self,
        binding: MobileSimulatorRuntimeBinding,
        actor_ptid: str,
        checkpoint: str,
    ) -> dict[str, Any]:
        profile = self._mapping(
            binding.call_action(CLIENT_ID, "settings.profile.read"),
            f"{checkpoint} profile",
        )
        if profile.get("actorPtid") != actor_ptid:
            raise GateError(f"{checkpoint} business read changed actor identity")
        self._record("business-profile-read", checkpoint=checkpoint)
        return profile

    def _wait_scope(
        self,
        binding: MobileSimulatorRuntimeBinding,
        predicate: Callable[[Mapping[str, Any]], bool],
    ) -> dict[str, Any]:
        deadline = time.monotonic() + 60
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last = self._scope(binding)
            if predicate(last):
                return last
            time.sleep(0.5)
        raise GateError(f"Mobile scope did not converge: {last}")

    @staticmethod
    def _active_route(
        projection: Mapping[str, Any],
        station_peer_id: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        entries = projection.get("entries")
        if not isinstance(entries, list):
            raise GateError("Mobile Station registry has no entries")
        matches = [
            dict(entry)
            for entry in entries
            if isinstance(entry, Mapping)
            and entry.get("stationPeerId") == station_peer_id
        ]
        if len(matches) != 1:
            raise GateError("Mobile Station registry identity is ambiguous")
        entry = matches[0]
        routes = entry.get("routes")
        active_route_id = entry.get("activeRouteId")
        active = [
            dict(route)
            for route in routes
            if isinstance(route, Mapping)
            and route.get("routeId") == active_route_id
        ] if isinstance(routes, list) else []
        if len(active) != 1:
            raise GateError("Mobile Station active route is ambiguous")
        return entry, active[0]

    @staticmethod
    def _assert_session_scope(
        scope: Mapping[str, Any],
        station_peer_id: str,
        actor_ptid: str,
    ) -> None:
        if (
            scope.get("activeStationPeerId") != station_peer_id
            or scope.get("activeActorPtid") != actor_ptid
        ):
            raise GateError("Mobile route transition changed the Session scope")

    def _cleanup(
        self,
        binding: MobileSimulatorRuntimeBinding | None,
    ) -> str | None:
        if binding is None:
            return None
        failures: list[str] = []
        if self.client_active:
            try:
                value = binding.call_action(CLIENT_ID, "cleanup")
                if not isinstance(value, Mapping):
                    raise GateError("Mobile cleanup response is invalid")
            except Exception as error:
                failures.append(f"product cleanup: {type(error).__name__}")
                self.cleanup.append(
                    {"resource": "product-harness", "status": "failed"}
                )
            else:
                self.cleanup.append(
                    {"resource": "product-harness", "status": "passed"}
                )
        try:
            stopped = binding.close()
        except Exception as error:
            failures.append(f"runtime cleanup: {type(error).__name__}")
            self.cleanup.append(
                {"resource": "runtime-binding", "status": "failed"}
            )
        else:
            self.cleanup.append(
                {
                    "resource": "runtime-binding",
                    "status": "passed",
                    "stoppedClients": list(stopped),
                }
            )
        return "; ".join(failures) if failures else None

    def _record(self, event: str, **detail: Any) -> None:
        self.events.append(
            {"event": event, "atUnixMs": int(time.time() * 1000), **detail}
        )

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "ios-simulator",
            "status": status,
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "phase": self.phase,
            "bom": list(self.bom),
            "spec": list(self.spec),
            "observedScope": [],
            "unprovenScope": [],
            "physicalDeviceClaimed": False,
            "stationMocksUsed": False,
        }

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    @staticmethod
    def _required_text(value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} is missing")
        return value

    @staticmethod
    def _positive_int(value: object, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise GateError(f"{label} is invalid")
        return value


def main() -> int:
    return MobileRelayNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
