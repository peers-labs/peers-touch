from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import Any

from tooling.acceptance.core import ActorRuntime
from tooling.acceptance.gates.station_access.session_class_suite_e2e import (
    GATE_ID,
    SCENARIO_IDS,
    StationAccessSessionClassSuiteGate,
)


class _FakeBinding:
    def binding_proof_evidence(self) -> dict[str, object]:
        return {
            "proofRefs": [{"path": "binding.json"}],
            "allocatedGenerations": {},
            "proofCount": 5,
        }

    def proof_refs(self) -> tuple[dict[str, str], ...]:
        return ({"path": "binding.json"},)


class _FakeRuntime:
    def __init__(self) -> None:
        self.manifest = {
            "environmentId": "chat-mixed-native",
            "runId": "fixture-epoch-1",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
            },
        }
        self.actor_manifest = {"runId": "fixture-epoch-1"}
        self.desktop_binding = _FakeBinding()
        self.desktop_revoked = False
        self.mobile_revoked = False
        self.prepared_desktop_identity: list[tuple[str, str]] = []
        self.marked_desktop_revoked: list[str] = []
        self.started: list[str] = []
        self.identities = {
            "desktop-alice": SimpleNamespace(
                actor="alice",
                station_service_id="station-primary",
                station_peer_id="station-peer",
                ptid="ptid:alice",
                device_id="desktop-alice-device",
                federation_id="fed-1",
            ),
            "desktop-bob": SimpleNamespace(
                actor="bob",
                station_service_id="station-primary",
                station_peer_id="station-peer",
                ptid="ptid:bob",
                device_id="desktop-bob-device",
                federation_id="fed-1",
            ),
            "desktop-bob-peer": SimpleNamespace(
                actor="bob",
                station_service_id="station-primary",
                station_peer_id="station-peer",
                ptid="ptid:bob",
                device_id="desktop-bob-peer-device",
                federation_id="fed-1",
            ),
            "sim-ios": SimpleNamespace(
                actor="bob",
                station_service_id="station-primary",
                station_peer_id="station-peer",
                ptid="ptid:bob",
                device_id="mobile-bob-device",
                federation_id="fed-1",
            ),
            "sim-ios-peer": SimpleNamespace(
                actor="bob",
                station_service_id="station-primary",
                station_peer_id="station-peer",
                ptid="ptid:bob",
                device_id="mobile-bob-peer-device",
                federation_id="fed-1",
            ),
        }

    def start_client(
        self,
        client_id: str,
        *,
        window_slot: int,
        window_count: int,
    ) -> SimpleNamespace:
        del window_slot, window_count
        self.started.append(client_id)
        if client_id == "desktop-bob-peer":
            self.desktop_revoked = True
        if client_id == "sim-ios-peer":
            self.mobile_revoked = True
        return self.identities[client_id]

    def actor_runtime(self, client_id: str) -> ActorRuntime:
        return ActorRuntime(name=client_id, runtime="fake-native")

    def source_identity(self) -> dict[str, object]:
        return {
            "orchestrator": dict(self.manifest["source"]),
            "desktopRuntimeCell": {"cellId": "desktop-macos-native"},
            "mobileRuntimeCell": "ios-simulator",
        }

    def create_direct(
        self,
        sender_id: str,
        receiver_id: str,
        *,
        federation_id: str,
        timeout_seconds: float,
    ) -> str:
        del sender_id, receiver_id, federation_id, timeout_seconds
        return "direct-1"

    def wait_for_message(
        self,
        client_id: str,
        conversation_id: str,
        message_id: str,
        predicate: Any,
        **_: Any,
    ) -> dict[str, object]:
        value = {
            "messageId": message_id,
            "plaintext": f"visible-{message_id}",
            "eventSequence": 1,
        }
        if not predicate(value):
            value["plaintext"] = str(message_id)
        return value

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: dict[str, object] | None = None,
        **_: Any,
    ) -> dict[str, object]:
        del payload
        if (
            client_id in {"desktop-bob", "desktop-bob-peer"}
            and action == "identityState"
        ):
            revoked = client_id == "desktop-bob" and self.desktop_revoked
            return {
                "authenticated": not revoked,
                "phase": "revoked" if revoked else "active",
                "reason": "revoked" if revoked else "",
            }
        raise AssertionError((client_id, action))

    def set_mobile_suspended(self, client_id: str, suspended: bool) -> None:
        del client_id, suspended

    def mark_desktop_auth_revoked(self, client_id: str) -> None:
        self.marked_desktop_revoked.append(client_id)

    def prepare_desktop_actor_identity(
        self,
        source_client_id: str,
        target_client_id: str,
    ) -> None:
        self.prepared_desktop_identity.append(
            (source_client_id, target_client_id)
        )

    def scope_snapshot(self, client_id: str) -> dict[str, object]:
        identity = self.identities[client_id]
        if client_id == "sim-ios" and self.mobile_revoked:
            return {
                "phase": "ACTIVE",
                "launchState": "access-gate-chain",
                "stationPeerId": identity.station_peer_id,
                "runtimeStationPeerId": None,
                "actorPtid": None,
            }
        return {
            "phase": "ACTIVE",
            "launchState": "shell",
            "stationPeerId": identity.station_peer_id,
            "runtimeStationPeerId": identity.station_peer_id,
            "actorPtid": identity.ptid,
        }

    @staticmethod
    def wait_until(
        predicate: Any,
        description: str,
        *,
        timeout_seconds: float,
    ) -> Any:
        del description, timeout_seconds
        value = predicate()
        if not value:
            raise AssertionError("fake wait predicate did not pass")
        return value

    def cleanup(self, **_: object) -> dict[str, object]:
        return {
            "mobileSessionsReleased": True,
            "desktop": {
                "portsReleased": True,
                "processesReleased": True,
                "storageReleased": True,
                "logsReleased": True,
            },
            "cleanupErrors": [],
        }


class _TestGate(StationAccessSessionClassSuiteGate):
    def _send_desktop_ui(
        self,
        sender_id: str,
        conversation_id: str,
        text: str,
        evidence_key: str,
    ) -> tuple[str, str]:
        del sender_id, conversation_id, text
        return f"message-{evidence_key}", f"artifact:{evidence_key}:sender"

    def _assert_desktop_receiver(
        self,
        receiver_id: str,
        conversation_id: str,
        text: str,
        evidence_key: str,
    ) -> str:
        del receiver_id, conversation_id, text
        return f"artifact:{evidence_key}:desktop-receiver"

    def _assert_mobile_receiver(
        self,
        receiver_id: str,
        conversation_id: str,
        message_id: str,
        text: str,
        evidence_key: str,
    ) -> str:
        del receiver_id, conversation_id, message_id, text
        return f"artifact:{evidence_key}:mobile-receiver"

    def _attach_suite_report(self, report: dict[str, Any]) -> dict[str, str]:
        return {
            "path": "evidence/suite-runtime.json",
            "sha256": report["reportDigest"],
        }


class StationAccessSessionClassSuiteGateTest(unittest.TestCase):
    def test_one_runtime_closes_all_session_class_scenarios(self) -> None:
        runtime = _FakeRuntime()
        gate = _TestGate(runtime=runtime)

        result = gate.run()

        self.assertEqual(gate.gate_id, GATE_ID)
        self.assertEqual(result["scenarioResults"], {
            scenario_id: "PASS" for scenario_id in SCENARIO_IDS
        })
        report = result["suiteRuntimeReport"]
        self.assertEqual(report["result"], "PASS")
        self.assertEqual(report["proofState"], "SUPPORTING")
        self.assertEqual(report["metrics"]["provisioningRuns"], 1)
        self.assertEqual(report["metrics"]["clientLaunches"], 5)
        self.assertEqual(report["metrics"]["completedScenarios"], 4)
        self.assertEqual(report["metrics"]["warmReuseRate"], 0.75)
        self.assertEqual(report["events"][-1]["action"], "cleanup-complete")
        self.assertEqual(len(report["reportDigest"]), 64)
        self.assertEqual(
            runtime.started,
            [
                "desktop-alice",
                "desktop-bob",
                "sim-ios",
                "desktop-bob-peer",
                "sim-ios-peer",
            ],
        )
        self.assertEqual(runtime.marked_desktop_revoked, ["desktop-bob"])
        self.assertEqual(
            runtime.prepared_desktop_identity,
            [("desktop-bob", "desktop-bob-peer")],
        )


if __name__ == "__main__":
    unittest.main()
