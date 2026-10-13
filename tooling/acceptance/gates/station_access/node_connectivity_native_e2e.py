#!/usr/bin/env python3
"""Prove real Native Chat through the standard libp2p Circuit route."""

from __future__ import annotations

import json
import re
import sys
import time
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.gates.chat.native_support import (
    selected_native_runtime,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    require,
    validate_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
    NativeTwoClientGate,
)
from tooling.acceptance.node_connectivity_native_support import (
    ATTACHMENT_BYTES,
    ROUTE_PROBE_PATH,
    DirectRouteFaultProxy,
    NodeConnectivityNativeJourneyMixin,
    add_station_candidate,
    prove_profile_mutation_readback,
    route_probe,
    session_identity,
    transport_diagnostics,
)
from tooling.acceptance.gates.station_access.relay_native_support import (
    is_relay_transport,
    station_registry_snapshot,
)


GATE_ID = "NCP-G03"
ENVIRONMENT_ID = "station-access-relay-role"
RUNTIME_CELL_ID = "desktop-macos-native"
JOURNEY_ID = "native-circuit-chat"
NCP_ASSERTIONS = {
    "native_actor_identity_state_persistent",
    "native_device_enrollment_profile_revision",
    "native_clients_use_circuit_route",
    "native_text_read",
    "native_attachment_receiver_visible",
    "native_attachment_byte_exact",
    "native_direct_only_route",
    "native_relay_only_route",
    "native_auto_route_ordered_failover",
    "native_route_failures_typed",
    "native_route_switch_preserves_session",
    "native_route_lease_fenced",
    "native_profile_mutation_readback",
}
NCP_REQUIRED_ASSERTIONS = REQUIRED_ASSERTIONS | NCP_ASSERTIONS
NCP_REQUIRED_STEPS = (
    REQUIRED_STEPS
    - {"fixture.reset"}
    | {
        "fixture.existing",
        "route.direct-only",
        "route.no-route",
        "route.relay-only",
        "route.policy-conflict",
        "route.auto-failover",
        "route.circuit",
        "receipt.read",
        "attachment.upload",
        "attachment.received",
        "attachment.opened",
        "attachment.digest",
    }
)


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{label} must be an object")
    return dict(value)


class NodeConnectivityNativeGate(
    NodeConnectivityNativeJourneyMixin,
    NativeTwoClientGate,
):
    gate_id = GATE_ID
    phase = "NCP-03"
    bom = ("NCP-NS02", "NCP-NS04")
    spec = ("NCP-G03", "node-connectivity-standard-stream")

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "NCP-G03 requires the station-access-relay-role environment"
            )
        if runtime_binding.cell_id != RUNTIME_CELL_ID:
            raise GateError(
                f"NCP-G03 requires {RUNTIME_CELL_ID}, got "
                f"{runtime_binding.cell_id}"
            )
        services = _mapping(manifest.get("services"), "runtime services")
        station = _mapping(services.get("station"), "direct Station service")
        self.services = services
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=GATE_ID,
            allow_existing_fixture=True,
            journey_id=JOURNEY_ID,
            station_identity_url=str(station.get("endpoint") or ""),
        )

    def _prove_circuit_routes(self) -> dict[str, Any]:
        station = _mapping(self.services.get("station"), "Station service")
        relay = _mapping(self.services.get("relay"), "Relay service")
        expected_station_peer_id = str(
            station.get("runtimeIdentity") or ""
        )
        expected_relay_peer_id = str(relay.get("runtimeIdentity") or "")
        relay_locator = str(relay.get("endpoint") or "")
        routes = {
            actor: station_registry_snapshot(client)
            for actor, client in self.clients.items()
        }
        valid = bool(
            expected_station_peer_id
            and expected_relay_peer_id
            and relay_locator
        ) and all(
            snapshot.get("stationPeerId") == expected_station_peer_id
            and (snapshot.get("route") or {}).get("route_type") == "relay"
            and (snapshot.get("route") or {}).get("health") == "available"
            and (snapshot.get("route") or {}).get("relay_peer_id")
            == expected_relay_peer_id
            and is_relay_transport(
                relay_locator,
                (snapshot.get("route") or {}).get("endpoint_origin"),
            )
            for snapshot in routes.values()
        )
        self.assert_condition(
            "native_clients_use_circuit_route",
            valid,
            json.dumps(routes, sort_keys=True),
        )
        return routes

    @staticmethod
    def _attempts_since(
        diagnostics: dict[str, Any],
        sequence: int,
        policy: str,
    ) -> list[dict[str, Any]]:
        attempts = diagnostics.get("attempts")
        if not isinstance(attempts, list):
            raise GateError("Station transport diagnostics omitted attempts")
        return [
            dict(attempt)
            for attempt in attempts
            if isinstance(attempt, Mapping)
            and int(attempt.get("sequence") or 0) > sequence
            and attempt.get("policy") == policy
            and attempt.get("requestPath") == ROUTE_PROBE_PATH
        ]

    @staticmethod
    def _last_sequence(diagnostics: dict[str, Any]) -> int:
        values = [
            int(item.get("sequence") or 0)
            for key in ("attempts", "transitions")
            for item in diagnostics.get(key, [])
            if isinstance(item, Mapping)
        ]
        return max(values, default=0)

    def _prove_route_policy_matrix(self) -> dict[str, Any]:
        station = _mapping(self.services.get("station"), "Station service")
        via_relay = _mapping(
            self.services.get("station-via-relay"),
            "Station Circuit service",
        )
        direct_url = str(station.get("endpoint") or "")
        relay_url = str(via_relay.get("endpoint") or "")
        if not direct_url or not relay_url:
            raise GateError("route-policy matrix requires Direct and Circuit services")

        alice = self.clients["alice"]
        bob = self.clients["bob"]
        proxy = DirectRouteFaultProxy(direct_url)
        proxy.start()
        override = self.runtime_binding.create_transport_override(
            "alice",
            "station",
            proxy.url,
        )
        try:
            self.runtime_binding.apply_verified_direct_route_override(
                "alice",
                "station",
                override,
            )
            add_station_candidate(alice, relay_url)
            before = station_registry_snapshot(alice)
            if (before.get("route") or {}).get("route_type") != "direct":
                raise GateError("Alice did not retain the Direct route before failover")

            diagnostics = transport_diagnostics(alice)
            baseline = self._last_sequence(diagnostics)
            direct_probe = self.step(
                "route.direct-only",
                lambda: route_probe(alice, "direct_only"),
                "alice",
            )
            direct_attempts = self._attempts_since(
                transport_diagnostics(alice),
                baseline,
                "direct_only",
            )
            direct_attempt = direct_attempts[-1] if direct_attempts else {}
            direct_mutation = prove_profile_mutation_readback(
                sender=alice,
                receiver=bob,
                sender_ptid=self.ptids["alice"],
                marker=f"ncp-direct-profile-{time.time_ns()}",
            )

            bob_diagnostics = transport_diagnostics(bob)
            bob_baseline = self._last_sequence(bob_diagnostics)
            relay_probe = self.step(
                "route.relay-only",
                lambda: route_probe(bob, "relay_only"),
                "bob",
            )
            relay_attempts = self._attempts_since(
                transport_diagnostics(bob),
                bob_baseline,
                "relay_only",
            )
            relay_attempt = relay_attempts[-1] if relay_attempts else {}
            relay_mutation = prove_profile_mutation_readback(
                sender=bob,
                receiver=alice,
                sender_ptid=self.ptids["bob"],
                marker=f"ncp-relay-profile-{time.time_ns()}",
            )

            policy_conflict = self.step(
                "route.policy-conflict",
                lambda: route_probe(alice, "relay_only"),
                "alice",
            )
            proxy.arm()
            try:
                no_route = self.step(
                    "route.no-route",
                    lambda: route_probe(alice, "direct_only"),
                    "alice",
                )
            finally:
                proxy.disarm()

            session_before = session_identity(alice)
            auto_before = station_registry_snapshot(alice)
            auto_diagnostics = transport_diagnostics(alice)
            auto_baseline = self._last_sequence(auto_diagnostics)
            proxy_failures_before = int(
                proxy.evidence().get("failureCount") or 0
            )
            proxy.arm()
            try:
                auto_probe = self.step(
                    "route.auto-failover",
                    lambda: route_probe(alice, "auto"),
                    "alice",
                )
            finally:
                proxy.disarm()
            after = station_registry_snapshot(alice)
            session_after = session_identity(alice)
            final_diagnostics = transport_diagnostics(alice)
            auto_attempts = self._attempts_since(
                final_diagnostics,
                auto_baseline,
                "auto",
            )
            transitions = [
                dict(item)
                for item in final_diagnostics.get("transitions", [])
                if isinstance(item, Mapping)
                and int(item.get("sequence") or 0) > auto_baseline
                and item.get("reason") == "automatic_failover"
            ]
            transition = transitions[-1] if transitions else {}
            proxy_evidence = proxy.evidence()
            proxy_failure_delta = int(
                proxy_evidence.get("failureCount") or 0
            ) - proxy_failures_before

            direct_valid = (
                direct_probe.get("ok") is True
                and direct_attempt.get("routeType") == "direct"
                and direct_attempt.get("outcome") == "connected"
            )
            relay_valid = (
                relay_probe.get("ok") is True
                and relay_attempt.get("routeType") == "relay"
                and relay_attempt.get("outcome") == "connected"
            )
            auto_valid = (
                auto_probe.get("ok") is True
                and len(auto_attempts) == 2
                and auto_attempts[0].get("routeType") == "direct"
                and auto_attempts[0].get("outcome") == "failed"
                and auto_attempts[1].get("routeType") == "relay"
                and auto_attempts[1].get("outcome") == "connected"
                and int(auto_attempts[0].get("sequence") or 0)
                < int(auto_attempts[1].get("sequence") or 0)
                and proxy_failure_delta >= 1
            )
            session_preserved = (
                before.get("stationPeerId") == after.get("stationPeerId")
                and before.get("stationPeerId")
                == auto_before.get("stationPeerId")
                and before.get("lifecycleGeneration")
                == after.get("lifecycleGeneration")
                and session_before == session_after
            )
            lease_fenced = (
                int(after.get("routeRevision") or 0)
                > int(auto_before.get("routeRevision") or 0)
                and transition.get("previousLeaseCancelled") is True
                and transition.get("previousRouteId")
                == auto_before.get("activeRouteId")
                and transition.get("nextRouteId")
                == after.get("activeRouteId")
            )
            mutations_valid = all(
                mutation.get("receiverVisible") is True
                and mutation.get("readbackMatches") is True
                and mutation.get("restored") is True
                for mutation in (direct_mutation, relay_mutation)
            )
            typed_failures = (
                no_route.get("ok") is False
                and no_route.get("code") == "station_no_route"
                and policy_conflict.get("ok") is False
                and policy_conflict.get("code")
                == "station_route_policy_conflict"
            )

            evidence = {
                "directOnly": {
                    "policy": "direct_only",
                    "probe": direct_probe,
                    "attempt": direct_attempt,
                    "mutation": direct_mutation,
                },
                "relayOnly": {
                    "policy": "relay_only",
                    "probe": relay_probe,
                    "attempt": relay_attempt,
                    "mutation": relay_mutation,
                },
                "noRoute": no_route,
                "policyConflict": policy_conflict,
                "auto": {
                    "policy": "auto",
                    "probe": auto_probe,
                    "attempts": auto_attempts,
                    "before": auto_before,
                    "after": after,
                    "sessionBefore": session_before,
                    "sessionAfter": session_after,
                    "transition": transition,
                    "proxy": {
                        **proxy_evidence,
                        "autoFailureDelta": proxy_failure_delta,
                    },
                },
            }
            self.assert_condition(
                "native_direct_only_route",
                direct_valid,
                json.dumps(evidence["directOnly"], sort_keys=True),
            )
            self.assert_condition(
                "native_relay_only_route",
                relay_valid,
                json.dumps(evidence["relayOnly"], sort_keys=True),
            )
            self.assert_condition(
                "native_auto_route_ordered_failover",
                auto_valid,
                json.dumps(evidence["auto"], sort_keys=True),
            )
            self.assert_condition(
                "native_route_failures_typed",
                typed_failures,
                json.dumps(
                    {
                        "noRoute": no_route,
                        "policyConflict": policy_conflict,
                    },
                    sort_keys=True,
                ),
            )
            self.assert_condition(
                "native_route_switch_preserves_session",
                session_preserved,
                json.dumps(evidence["auto"], sort_keys=True),
            )
            self.assert_condition(
                "native_route_lease_fenced",
                lease_fenced,
                json.dumps(evidence["auto"], sort_keys=True),
            )
            self.assert_condition(
                "native_profile_mutation_readback",
                mutations_valid,
                json.dumps(
                    {
                        "direct": direct_mutation,
                        "relay": relay_mutation,
                    },
                    sort_keys=True,
                ),
            )
            return evidence
        finally:
            try:
                self.runtime_binding.clear_verified_direct_route_override(
                    "alice",
                    "station",
                    override,
                )
            finally:
                proxy.stop()

    def prove_additional_journey_assertions(self) -> None:
        identity_state = self._prove_persistent_identity_state()
        route_policy = self._prove_route_policy_matrix()
        routes = self.step("route.circuit", self._prove_circuit_routes)
        read = self.step("receipt.read", self._prove_read_receipt)
        attachment = self._prove_attachment()
        self.report.runtime["nodeConnectivity"] = {
            "identityState": identity_state,
            "routePolicy": route_policy,
            "routes": routes,
            "read": read,
            "attachment": attachment,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {
            assertion.name for assertion in self.report.assertions
        }
        missing = NCP_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"NCP-G03 assertions are missing: {sorted(missing)}"
            )
        return result


def validate_ncp_report(report: dict[str, Any]) -> None:
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    evidence = runtime.get("nodeConnectivity")
    require(
        isinstance(evidence, dict),
        "node-connectivity evidence is required",
    )
    routes = evidence.get("routes")
    identity_state = evidence.get("identityState")
    read = evidence.get("read")
    attachment = evidence.get("attachment")
    route_policy = evidence.get("routePolicy")
    manifest = report.get("manifest")
    services = (
        manifest.get("services")
        if isinstance(manifest, dict)
        and isinstance(manifest.get("services"), dict)
        else {}
    )
    station = (
        services.get("station")
        if isinstance(services.get("station"), dict)
        else {}
    )
    relay = (
        services.get("relay")
        if isinstance(services.get("relay"), dict)
        else {}
    )
    expected_station_peer_id = str(
        station.get("runtimeIdentity") or ""
    )
    expected_relay_peer_id = str(relay.get("runtimeIdentity") or "")
    relay_locator = str(relay.get("endpoint") or "")
    require(
        isinstance(identity_state, dict)
        and set(identity_state) == {"alice", "bob"}
        and len(
            {
                str(item.get("storageRoot") or "")
                for item in identity_state.values()
                if isinstance(item, dict)
            }
        )
        == 2
        and all(
            isinstance(item, dict)
            and item.get("storageLifecycle") == "persistent"
            and item.get("devicePolicy") == "persistent-acceptance"
            and bool(item.get("storageRoot"))
            and isinstance(item.get("endpoint"), dict)
            and isinstance(item.get("profile"), dict)
            and item["endpoint"].get("active") is True
            and int(item["endpoint"].get("profileRevision") or 0)
            == int(item["profile"].get("profile_revision") or 0)
            > 0
            for item in identity_state.values()
        ),
        "Native Actor identity storage must be persistent and isolated",
    )
    require(
        isinstance(routes, dict) and set(routes) == {"alice", "bob"},
        "both Native clients require Circuit route evidence",
    )
    require(
        all(
            isinstance(snapshot, dict)
            and snapshot.get("stationPeerId")
            == expected_station_peer_id
            and (snapshot.get("route") or {}).get("route_type") == "relay"
            and (snapshot.get("route") or {}).get("health") == "available"
            and (snapshot.get("route") or {}).get("relay_peer_id")
            == expected_relay_peer_id
            and is_relay_transport(
                relay_locator,
                (snapshot.get("route") or {}).get("endpoint_origin"),
            )
            for snapshot in routes.values()
        )
        and bool(expected_station_peer_id)
        and bool(expected_relay_peer_id)
        and bool(relay_locator),
        "both Native clients must use routes bound to the attested Relay PeerID",
    )
    require(
        isinstance(route_policy, dict),
        "route-policy evidence is incomplete",
    )
    direct_only = route_policy.get("directOnly")
    relay_only = route_policy.get("relayOnly")
    no_route = route_policy.get("noRoute")
    policy_conflict = route_policy.get("policyConflict")
    auto = route_policy.get("auto")
    auto_attempts = (
        auto.get("attempts") if isinstance(auto, dict) else None
    )
    auto_before = auto.get("before") if isinstance(auto, dict) else None
    auto_after = auto.get("after") if isinstance(auto, dict) else None
    session_before = (
        auto.get("sessionBefore") if isinstance(auto, dict) else None
    )
    session_after = (
        auto.get("sessionAfter") if isinstance(auto, dict) else None
    )
    transition = (
        auto.get("transition") if isinstance(auto, dict) else None
    )
    require(
        isinstance(direct_only, dict)
        and direct_only.get("policy") == "direct_only"
        and (direct_only.get("attempt") or {}).get("routeType") == "direct"
        and (direct_only.get("attempt") or {}).get("requestPath")
        == ROUTE_PROBE_PATH
        and (direct_only.get("attempt") or {}).get("outcome")
        == "connected"
        and (direct_only.get("mutation") or {}).get("receiverVisible")
        is True
        and (direct_only.get("mutation") or {}).get("readbackMatches")
        is True
        and isinstance(relay_only, dict)
        and relay_only.get("policy") == "relay_only"
        and (relay_only.get("attempt") or {}).get("routeType") == "relay"
        and (relay_only.get("attempt") or {}).get("requestPath")
        == ROUTE_PROBE_PATH
        and (relay_only.get("attempt") or {}).get("outcome")
        == "connected"
        and (relay_only.get("mutation") or {}).get("receiverVisible")
        is True
        and (relay_only.get("mutation") or {}).get("readbackMatches")
        is True
        and isinstance(no_route, dict)
        and no_route.get("code") == "station_no_route"
        and isinstance(policy_conflict, dict)
        and policy_conflict.get("code")
        == "station_route_policy_conflict"
        and isinstance(auto, dict)
        and auto.get("policy") == "auto"
        and isinstance(auto_attempts, list)
        and len(auto_attempts) == 2
        and auto_attempts[0].get("routeType") == "direct"
        and auto_attempts[0].get("requestPath") == ROUTE_PROBE_PATH
        and auto_attempts[0].get("outcome") == "failed"
        and auto_attempts[1].get("routeType") == "relay"
        and auto_attempts[1].get("requestPath") == ROUTE_PROBE_PATH
        and auto_attempts[1].get("outcome") == "connected"
        and int(auto_attempts[0].get("sequence") or 0)
        < int(auto_attempts[1].get("sequence") or 0)
        and isinstance(auto_before, dict)
        and isinstance(auto_after, dict)
        and auto_before.get("stationPeerId")
        == auto_after.get("stationPeerId")
        and auto_before.get("lifecycleGeneration")
        == auto_after.get("lifecycleGeneration")
        and int(auto_after.get("routeRevision") or 0)
        > int(auto_before.get("routeRevision") or 0)
        and isinstance(session_before, dict)
        and isinstance(session_after, dict)
        and session_before == session_after
        and all(
            re.fullmatch(r"[0-9a-f]{64}", str(session_before.get(field) or ""))
            is not None
            for field in ("session_id_sha256", "session_binding_sha256")
        )
        and isinstance(transition, dict)
        and transition.get("previousLeaseCancelled") is True
        and transition.get("previousRouteId")
        == auto_before.get("activeRouteId")
        and transition.get("nextRouteId") == auto_after.get("activeRouteId")
        and int(transition.get("previousRouteRevision") or 0)
        == int(auto_before.get("routeRevision") or 0)
        and int(transition.get("nextRouteRevision") or 0)
        == int(auto_after.get("routeRevision") or 0)
        and transition.get("lifecycleGeneration")
        == auto_after.get("lifecycleGeneration")
        and (auto.get("proxy") or {}).get("failureCount", 0) >= 2
        and (auto.get("proxy") or {}).get("autoFailureDelta", 0) >= 1,
        "route-policy evidence is incomplete",
    )
    require(
        isinstance(read, dict)
        and (read.get("sender") or {}).get("receipt") == "read"
        and (read.get("sender") or {}).get("messageUlid")
        == (read.get("receiver") or {}).get("messageUlid"),
        "Native text must reach sender-visible READ",
    )
    require(
        isinstance(attachment, dict)
        and attachment.get("byteLength") == ATTACHMENT_BYTES
        and (attachment.get("receiverSnapshot") or {}).get("visible") is True
        and (attachment.get("openedSnapshot") or {}).get("openState")
        == "ready"
        and re.fullmatch(
            r"[0-9a-f]{64}",
            str(attachment.get("sourceSha256") or ""),
        )
        is not None
        and attachment.get("sourceSha256")
        == attachment.get("receiverSha256"),
        "32 MiB receiver-opened attachment evidence is incomplete",
    )


def write_ncp_validation(
    report: dict[str, Any],
    source_ref: ArtifactRef,
) -> ArtifactRef:
    output = {
        "artifactKind": "node-connectivity-native-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "NCP-03",
        "bom": ["NCP-NS02", "NCP-NS04"],
        "spec": ["NCP-G03", "node-connectivity-standard-stream"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(NCP_REQUIRED_ASSERTIONS),
    }
    return ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=GATE_ID,
    ).write_json(
        f"reports/{GATE_ID}-validation.json",
        output,
        role="validation",
    )


def validate_current_report() -> None:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, GATE_ID)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=NCP_REQUIRED_STEPS,
        required_assertions=NCP_REQUIRED_ASSERTIONS,
        expected_journey=JOURNEY_ID,
    )
    validate_ncp_report(report)
    write_ncp_validation(report, source_ref)


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = NodeConnectivityNativeGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    result = gate.execute()
    if result != 0:
        return result
    validate_current_report()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"NCP-G03 validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
