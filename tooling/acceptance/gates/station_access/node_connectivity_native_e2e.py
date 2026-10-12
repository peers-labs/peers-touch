#!/usr/bin/env python3
"""Prove real Native Chat through the standard libp2p Circuit route."""

from __future__ import annotations

import json
import re
import sys
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
    NodeConnectivityNativeJourneyMixin,
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
    "native_clients_use_circuit_route",
    "native_text_read",
    "native_attachment_receiver_visible",
    "native_attachment_byte_exact",
}
NCP_REQUIRED_ASSERTIONS = REQUIRED_ASSERTIONS | NCP_ASSERTIONS
NCP_REQUIRED_STEPS = (
    REQUIRED_STEPS
    - {"fixture.reset"}
    | {
        "fixture.existing",
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
        relay_locator = str(relay.get("endpoint") or "")
        routes = {
            actor: station_registry_snapshot(client)
            for actor, client in self.clients.items()
        }
        valid = bool(expected_station_peer_id and relay_locator) and all(
            snapshot.get("stationPeerId") == expected_station_peer_id
            and (snapshot.get("route") or {}).get("route_type") == "relay"
            and (snapshot.get("route") or {}).get("health") == "available"
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

    def prove_additional_journey_assertions(self) -> None:
        identity_state = self._prove_persistent_identity_state()
        routes = self.step("route.circuit", self._prove_circuit_routes)
        read = self.step("receipt.read", self._prove_read_receipt)
        attachment = self._prove_attachment()
        self.report.runtime["nodeConnectivity"] = {
            "identityState": identity_state,
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
            and is_relay_transport(
                relay_locator,
                (snapshot.get("route") or {}).get("endpoint_origin"),
            )
            for snapshot in routes.values()
        )
        and bool(expected_station_peer_id)
        and bool(relay_locator),
        "both Native clients must use Relay routes",
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
