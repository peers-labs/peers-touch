#!/usr/bin/env python3
"""Prove one logical Station survives Native traffic across two nodes."""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    call_async_harness,
    validate_suite_runtime_report,
)
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    enter_chat_page,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    NativeTwoClientGate,
    message_snapshot,
    send_text,
)
from tooling.acceptance.node_connectivity_native_support import (
    NodeConnectivityNativeJourneyMixin,
)
from tooling.acceptance.provisioners.node_connectivity_cluster import (
    cluster_message_readback,
    stop_cluster_node,
)


GATE_ID = "NCP-G06"
ENVIRONMENT_ID = "node-connectivity-cluster"
RUNTIME_CELL_ID = "desktop-macos-native"
JOURNEY_ID = "native-two-node-station-failover"
FAILOVER_SECONDS = 30
SCENARIOS = (
    "NCP-G04",
    "NCP-G05",
    "NCP-G06",
)
RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "cluster-functional",
        "scenarioIds": list(SCENARIOS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 2,
        "minWarmReuseRate": 0.66,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)
CLUSTER_ASSERTIONS = {
    "cluster_two_distinct_nodes_one_station",
    "cluster_cross_node_read_receipt",
    "cluster_cross_node_attachment",
    "cluster_failover_route_recovered",
    "cluster_failover_session_preserved",
    "cluster_failover_receiver_visible",
    "cluster_failover_no_duplicate_mutation",
    "cluster_failed_node_lease_withdrawn",
}


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{label} must be an object")
    return dict(value)


def _station_inventory(client: TauriSession) -> dict[str, Any]:
    result = client.invoke_app_result("station_list")
    data = result.get("data") if isinstance(result, dict) else None
    status = data.get("status") if isinstance(data, dict) else None
    try:
        payload = json.loads(status) if isinstance(status, str) else {}
    except json.JSONDecodeError as error:
        raise GateError("station_list returned invalid registry JSON") from error
    entries = payload.get("entries")
    active_station = str(payload.get("active_station_peer_id") or "")
    matching = [
        entry
        for entry in entries or []
        if isinstance(entry, dict)
        and entry.get("station_peer_id") == active_station
    ]
    if len(matching) != 1:
        raise GateError("Native Station registry has no unique active Station")
    entry = matching[0]
    active_route_id = str(entry.get("active_route_id") or "")
    routes = [
        dict(route)
        for route in entry.get("routes") or []
        if isinstance(route, dict)
    ]
    active = next(
        (
            route
            for route in routes
            if route.get("route_id") == active_route_id
        ),
        None,
    )
    if active is None:
        raise GateError("Native Station registry has no active route")
    return {
        "stationPeerId": active_station,
        "activeRouteId": active_route_id,
        "routeRevision": int(entry.get("route_revision") or 0),
        "activeRoute": active,
        "routes": routes,
    }


def _message_count(client: TauriSession, text: str) -> int:
    value = client.execute_script(
        """
        const text = arguments[0];
        return Array.from(document.querySelectorAll('[data-message-ulid]'))
          .filter((row) => (row.innerText || '').includes(text)).length;
        """,
        text,
    )
    return int(value or 0)


def _durable_readback_matches(
    value: Mapping[str, Any],
    *,
    expected_endpoint_count: int,
    expected_node_peer_id: str,
) -> bool:
    live_nodes = value.get("liveNodes") or []
    return (
        expected_endpoint_count > 0
        and int(value.get("eventCount") or 0) == 1
        and int(value.get("commitmentCount") or 0)
        == expected_endpoint_count
        and int(value.get("receiptCount") or 0)
        == expected_endpoint_count
        and len(live_nodes) == 1
        and live_nodes[0].get("node_peer_id") == expected_node_peer_id
    )


class NodeConnectivityClusterNativeGate(
    NodeConnectivityNativeJourneyMixin,
    NativeTwoClientGate,
):
    gate_id = GATE_ID
    phase = "NCP-08"
    bom = ("NCP-NS01", "NCP-NS03", "NCP-NS04")
    spec = (GATE_ID, ENVIRONMENT_ID, "ncp-cluster-journey")

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                f"{GATE_ID} requires the {ENVIRONMENT_ID} environment"
            )
        if runtime_binding.cell_id != RUNTIME_CELL_ID:
            raise GateError(
                f"{GATE_ID} requires {RUNTIME_CELL_ID}, got "
                f"{runtime_binding.cell_id}"
            )
        services = _mapping(manifest.get("services"), "runtime services")
        self.node_urls = {
            node: str(
                _mapping(services.get(node), node).get("endpoint") or ""
            ).rstrip("/")
            for node in ("station-node-a", "station-node-b")
        }
        if not all(self.node_urls.values()):
            raise GateError("cluster Station node endpoints are incomplete")
        NativeTwoClientGate.__init__(
            self,
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=GATE_ID,
            allow_existing_fixture=False,
            journey_id=JOURNEY_ID,
            station_identity_url=self.node_urls["station-node-a"],
        )
        self.suite = SuiteRuntimeLedger(
            RUNTIME_REUSE,
            suite_runtime_id=str(manifest.get("runId") or ""),
            source_digest=str(
                (manifest.get("source") or {}).get("commit") or ""
            ),
            fixture_epoch=str(manifest.get("runId") or ""),
        )
        self.suite.record(
            SuiteRuntimeAction.PROVISION,
            resource_id=f"environment:{manifest.get('runId')}",
        )

    def start_client(self, actor: str) -> None:
        super().start_client(actor)
        alternate = (
            self.node_urls["station-node-b"]
            if actor == "alice"
            else self.node_urls["station-node-a"]
        )
        result = self.clients[actor].invoke_app_result(
            "station_add",
            {"input": {"input": alternate}},
        )
        if not isinstance(result, dict) or result.get("error"):
            raise GateError(f"{actor} could not add its failover route")
        inventory = wait_until(
            lambda: (
                current
                if len(
                    {
                        str(route.get("endpoint_origin") or "").rstrip("/")
                        for route in current["routes"]
                        if route.get("health") == "available"
                    }
                    & set(self.node_urls.values())
                )
                == 2
                else None
            )
            if (current := _station_inventory(self.clients[actor]))
            else None,
            f"{actor} two-node Station route inventory",
            timeout=30,
        )
        expected_active = (
            self.node_urls["station-node-a"]
            if actor == "alice"
            else self.node_urls["station-node-b"]
        )
        if (
            str(
                inventory["activeRoute"].get("endpoint_origin") or ""
            ).rstrip("/")
            != expected_active
        ):
            raise GateError(
                f"{actor} active cluster route changed during discovery"
            )
        self.suite.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id=f"native-client:{actor}",
        )

    def _cluster_route_evidence(self) -> dict[str, Any]:
        inventories = {
            actor: _station_inventory(client)
            for actor, client in self.clients.items()
        }
        station_ids = {
            inventory["stationPeerId"]
            for inventory in inventories.values()
        }
        node_ids = {
            str(route.get("node_peer_id") or "")
            for inventory in inventories.values()
            for route in inventory["routes"]
            if str(route.get("endpoint_origin") or "").rstrip("/")
            in set(self.node_urls.values())
        }
        self.assert_condition(
            "cluster_two_distinct_nodes_one_station",
            len(station_ids) == 1
            and "" not in station_ids
            and len(node_ids) == 2
            and "" not in node_ids,
            json.dumps(inventories, sort_keys=True),
        )
        return inventories

    def _cross_node_scenario(self) -> dict[str, Any]:
        scenario = SCENARIOS[0]
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario,
        )
        inventories = self._cluster_route_evidence()
        read = self.step("cluster.receipt.read", self._prove_read_receipt)
        attachment = self._prove_attachment()
        self.suite.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario,
            resource_id="native:alice-send-and-attachment",
        )
        self.suite.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario,
            resource_id="native:bob-read-and-open",
        )
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario,
        )
        self.assert_condition(
            "cluster_cross_node_read_receipt",
            (read.get("sender") or {}).get("receipt") == "read",
            json.dumps(read, sort_keys=True),
        )
        self.assert_condition(
            "cluster_cross_node_attachment",
            attachment.get("sourceSha256")
            == attachment.get("receiverSha256"),
            json.dumps(attachment, sort_keys=True),
        )
        return {
            "inventories": inventories,
            "read": read,
            "attachment": attachment,
        }

    def _failover_scenario(self) -> dict[str, Any]:
        scenario = SCENARIOS[1]
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        refreshed = self.step(
            "cluster.route-b.refresh",
            lambda: alice.invoke_app_result(
                "station_add",
                {"input": {"input": self.node_urls["station-node-b"]}},
            ),
            "alice",
        )
        if not isinstance(refreshed, dict) or refreshed.get("error"):
            raise GateError("Alice could not refresh node B failover route")
        before = _station_inventory(alice)
        actor_before = self.ptids["alice"]
        device_before = self.device_ids["alice"]
        conversation_id = self._active_conversation_id()
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario,
        )
        started = time.monotonic()
        stopped = self.step(
            "cluster.node-a.stop",
            lambda: stop_cluster_node(self.manifest, "station-node-a"),
        )

        def recovered_route() -> dict[str, Any] | None:
            try:
                alice.invoke_app_result(
                    "conversation_sync_from_station",
                    {
                        "conversation_id": conversation_id,
                        "limit": 50,
                    },
                )
            except Exception:
                pass
            current = _station_inventory(alice)
            endpoint = str(
                current["activeRoute"].get("endpoint_origin") or ""
            ).rstrip("/")
            return (
                current
                if endpoint == self.node_urls["station-node-b"]
                and current["routeRevision"] > before["routeRevision"]
                else None
            )

        recovered = wait_until(
            recovered_route,
            "Alice automatic route failover to node B",
            timeout=FAILOVER_SECONDS,
            interval=0.25,
        )
        binding = call_async_harness(
            alice,
            "bindingState",
            {},
            namespace="stationAccess",
            script_timeout=10,
        )
        device = async_harness(alice, "getRealtimeDevice", {}, timeout=10)
        recovery_ms = round((time.monotonic() - started) * 1000)
        self.assert_condition(
            "cluster_failover_route_recovered",
            recovery_ms <= FAILOVER_SECONDS * 1000,
            json.dumps(
                {
                    "before": before,
                    "after": recovered,
                    "recoveryMs": recovery_ms,
                },
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "cluster_failover_session_preserved",
            isinstance(binding, dict)
            and binding.get("phase") == "bound"
            and isinstance(device, dict)
            and device.get("actorPtid") == actor_before
            and device.get("deviceId") == device_before
            and device.get("active") is True,
            json.dumps(
                {"binding": binding, "device": device},
                sort_keys=True,
            ),
        )
        for client in (alice, bob):
            enter_chat_page(client)
        text = f"ncp-failover-{time.time_ns()}"
        sent = self.step(
            "cluster.failover.send",
            lambda: send_text(alice, text),
            "alice",
        )
        received = self.step(
            "cluster.failover.received",
            lambda: wait_until(
                lambda: message_snapshot(bob, text),
                "Bob failover plaintext",
                timeout=60,
            ),
            "bob",
        )
        delivered = wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := message_snapshot(alice, text)
                )
                and snapshot.get("receipt") in {"delivered", "read"}
                else None
            ),
            "Alice failover delivery receipt",
            timeout=60,
        )
        self.suite.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario,
            resource_id="native:alice-post-failover-send",
        )
        self.suite.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario,
            resource_id="native:bob-post-failover-receive",
        )
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario,
        )
        self.assert_condition(
            "cluster_failover_receiver_visible",
            bool(sent.get("messageUlid"))
            and received.get("messageUlid") == sent.get("messageUlid")
            and delivered.get("messageUlid") == sent.get("messageUlid"),
            json.dumps(
                {
                    "sent": sent,
                    "received": received,
                    "delivered": delivered,
                },
                sort_keys=True,
            ),
        )
        return {
            "stopped": stopped,
            "before": before,
            "after": recovered,
            "binding": binding,
            "device": device,
            "recoveryMs": recovery_ms,
            "text": text,
            "messageId": str(sent.get("messageUlid") or ""),
            "received": received,
            "delivered": delivered,
        }

    def _durable_scenario(
        self,
        failover: Mapping[str, Any],
    ) -> dict[str, Any]:
        scenario = SCENARIOS[2]
        message_id = str(failover.get("messageId") or "")
        text = str(failover.get("text") or "")
        expected_endpoint_count = len(set(self.device_ids.values()))
        expected_node_peer_id = str(
            failover["after"]["activeRoute"].get("node_peer_id") or ""
        )
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario,
        )

        def durable() -> dict[str, Any] | None:
            value = cluster_message_readback(self.manifest, message_id)
            return (
                value
                if _durable_readback_matches(
                    value,
                    expected_endpoint_count=expected_endpoint_count,
                    expected_node_peer_id=expected_node_peer_id,
                )
                else None
            )

        readback = wait_until(
            durable,
            (
                "single durable event, exact endpoint receipts, "
                "and failed-node lease withdrawal"
            ),
            timeout=FAILOVER_SECONDS,
            interval=0.5,
        )
        counts = {
            actor: _message_count(client, text)
            for actor, client in self.clients.items()
        }
        self.suite.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario,
            resource_id="native:message-count-inspection",
        )
        self.suite.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario,
            resource_id="postgres:durable-message-readback",
        )
        self.suite.record(
            SuiteRuntimeAction.SUPPORTING_OBSERVATION,
            scenario_id=scenario,
            resource_id="postgres:station-node-registry",
        )
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario,
        )
        self.assert_condition(
            "cluster_failover_no_duplicate_mutation",
            counts == {"alice": 1, "bob": 1}
            and int(readback.get("eventCount") or 0) == 1
            and int(readback.get("commitmentCount") or 0)
            == expected_endpoint_count
            and int(readback.get("receiptCount") or 0)
            == expected_endpoint_count,
            json.dumps(
                {
                    "counts": counts,
                    "expectedEndpointCount": expected_endpoint_count,
                    "readback": readback,
                },
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "cluster_failed_node_lease_withdrawn",
            len(readback.get("liveNodes") or []) == 1,
            json.dumps(readback, sort_keys=True),
        )
        return {"counts": counts, "readback": readback}

    def prove_additional_journey_assertions(self) -> None:
        cross_node = self._cross_node_scenario()
        failover = self._failover_scenario()
        durable = self._durable_scenario(failover)
        self.report.runtime["nodeConnectivityCluster"] = {
            "crossNode": cross_node,
            "failover": failover,
            "durable": durable,
        }

    def run(self) -> dict[str, Any]:
        result = NativeTwoClientGate.run(self)
        assertion_names = {
            assertion.name for assertion in self.report.assertions
        }
        missing = CLUSTER_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"{GATE_ID} assertions are missing: {sorted(missing)}"
            )
        self.suite.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = self.suite.require_valid()
        validate_suite_runtime_report(
            suite_report,
            expected_contract=RUNTIME_REUSE,
        )
        self.report.runtime["suiteRuntime"] = suite_report
        result["suiteRuntime"] = suite_report
        return result


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = NodeConnectivityClusterNativeGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"{GATE_ID} validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
