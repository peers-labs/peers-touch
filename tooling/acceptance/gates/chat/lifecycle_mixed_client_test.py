from __future__ import annotations

import hashlib
import json
import unittest
from unittest.mock import ANY, MagicMock, call, patch

from tooling.acceptance.core import EnvironmentContract, GateError
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_call_resolution import (
    CallResolutionGate,
)
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedClientIdentity,
    MixedNativeRuntime,
)
from tooling.acceptance.provisioners import (
    ChatMixedNativeProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners.mobile_simulator import (
    CHAT_MIXED_NATIVE_GATE_IDS,
    CHAT_MIXED_NATIVE_HARNESS_ACTIONS,
    SIMULATOR_APPIUM_CAPABILITY_ID,
)


class MixedClientAcceptanceContractTest(unittest.TestCase):
    def test_environment_declares_desktop_mobile_topology(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "chat-mixed-native.yaml"
        )
        clients = {client.id: client for client in contract.clients}

        self.assertEqual(contract.id, "chat-mixed-native")
        self.assertEqual(
            {client.runtime for client in clients.values()},
            {"native-tauri", "tauri-ios-simulator"},
        )
        self.assertEqual(
            clients["desktop-alice"].service_bindings[
                "station"
            ].service_id,
            clients["sim-ios-peer"].service_bindings[
                "station"
            ].service_id,
        )
        self.assertEqual(
            clients["desktop-bob"].service_bindings["station"].service_id,
            clients["sim-ios"].service_bindings["station"].service_id,
        )
        self.assertEqual(
            clients["desktop-bob"].actor,
            clients["sim-ios"].actor,
        )
        self.assertIsInstance(
            get_provisioner(
                contract,
                station_profiles={
                    "station-primary": "four",
                    "station-secondary": "chat-native-disposable",
                },
            ),
            ChatMixedNativeProvisioner,
        )

    def test_catalog_uses_typed_ephemeral_mobile_capability(self) -> None:
        catalog = json.loads(
            (REPO_ROOT / "tooling" / "acceptance" / "gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        for gate_id in CHAT_MIXED_NATIVE_GATE_IDS:
            with self.subTest(gate_id=gate_id):
                gate = catalog[gate_id]
                self.assertEqual(gate["environment"], "chat-mixed-native")
                self.assertEqual(gate["provisioner"], "chat-mixed-native")
                self.assertNotIn("command", gate)
                self.assertEqual(
                    gate["ephemeralCapabilities"],
                    [SIMULATOR_APPIUM_CAPABILITY_ID],
                )

    def test_gate_sources_have_no_deferred_runtime_placeholders(self) -> None:
        for path in (
            "lifecycle_call_resolution.py",
            "lifecycle_mixed_client_same_station.py",
            "lifecycle_mixed_client_cross_station.py",
            "lifecycle_mixed_client_multi_device.py",
            "lifecycle_mixed_client_group_mls.py",
        ):
            with self.subTest(path=path):
                source = (
                    REPO_ROOT
                    / "tooling"
                    / "acceptance"
                    / "gates"
                    / "chat"
                    / path
                ).read_text(encoding="utf-8")
                self.assertNotIn("awaiting-runtime", source)
                self.assertNotIn("runtime verification deferred", source)
                self.assertIn("MixedNativeRuntime", source)

    def test_chat_child_actions_are_environment_declared(self) -> None:
        payload = json.loads(
            (
                ENVIRONMENTS_DIR / "chat-mixed-native.yaml"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            set(payload["harness"]["required_actions"]),
            CHAT_MIXED_NATIVE_HARNESS_ACTIONS,
        )

    def test_mobile_device_authority_is_digest_projected(self) -> None:
        result = ChatMixedNativeProvisioner._project_chat_harness_result(
            "callResolutionState",
            {
                "deviceId": "device-a",
                "winningDeviceId": "device-b",
                "nested": [{"device_id": "device-c"}],
            },
        )

        self.assertEqual(
            result,
            {
                "deviceIdentityDigest": hashlib.sha256(
                    b"device-a"
                ).hexdigest(),
                "winningDeviceIdentityDigest": hashlib.sha256(
                    b"device-b"
                ).hexdigest(),
                "nested": [
                    {
                        "deviceIdentityDigest": hashlib.sha256(
                            b"device-c"
                        ).hexdigest()
                    }
                ],
            },
        )
        self.assertEqual(
            MixedNativeRuntime._project_client_result(
                {"winningDeviceId": "device-b"}
            ),
            {
                "winningDeviceIdentityDigest": hashlib.sha256(
                    b"device-b"
                ).hexdigest()
            },
        )

    def test_desktop_reactions_use_the_mixed_client_projection_shape(self) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.client_specs = {
            "desktop-alice": {"runtime": "native-tauri"},
        }
        runtime.call_action = MagicMock(return_value={
            "messageId": "message-1",
            "content": "hello",
            "sequence": 2,
            "reactions": [
                {"actorPtid": "ptid:bob", "emoji": "ack"},
            ],
        })

        projection = runtime.message_projection(
            "desktop-alice",
            "direct-1",
            "message-1",
            kind="direct",
        )

        self.assertEqual(
            projection["reactions"],
            [
                {
                    "actorPtid": "ptid:bob",
                    "emoji": "ack",
                    "reaction": "ack",
                }
            ],
        )

    def test_mobile_start_waits_for_messaging_endpoint_activation(self) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.mobile_binding = MagicMock()
        runtime.mobile_binding.create_bound_session.return_value.scope = {
            "activeStationPeerId": "peer-secondary"
        }
        runtime.mobile_binding.authenticate_fixture_actor.return_value = {
            "login": {"session": {"actorPtid": "ptid:bob"}}
        }
        runtime.mobile_clients = []
        runtime.call_action = MagicMock(
            side_effect=[
                {"requested": True, "scope": "webview"},
                {
                    "phase": "ACTIVE",
                    "activeActorPtid": "ptid:bob",
                    "activeStationPeerId": "peer-secondary",
                },
                None,
                None,
            ]
        )
        expected_identity = object()
        runtime._identity_with_device = MagicMock(
            side_effect=[RuntimeError("not active"), expected_identity]
        )

        result = runtime._start_mobile(
            "sim-ios",
            {
                "ptid": "ptid:bob",
                "homeStationPeerId": "peer-secondary",
            },
        )

        self.assertIs(result, expected_identity)
        self.assertEqual(runtime._identity_with_device.call_count, 2)
        self.assertEqual(runtime.mobile_clients, ["sim-ios"])
        self.assertEqual(
            runtime.call_action.call_args_list,
            [
                call("sim-ios", "lifecycle.restart", {}),
                call("sim-ios", "lifecycle.scope.read", {}),
                call("sim-ios", "messaging.reconcile", {}),
                call("sim-ios", "messaging.reconcile", {}),
            ],
        )

    @patch(
        "tooling.acceptance.gates.chat.mixed_native_runtime."
        "MOBILE_WRITE_ADMISSION_STABLE_SECONDS",
        0,
    )
    def test_mobile_mutation_waits_for_write_admission_reconciliation(
        self,
    ) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.client_specs = {
            "sim-ios": {"runtime": "tauri-ios-simulator"},
        }
        runtime.mobile_clients = ["sim-ios"]
        runtime.mobile_binding = MagicMock()
        runtime.mobile_binding.call_action.side_effect = [
            {
                "isWriteBlocked": False,
                "writeAdmission": {
                    "open": False,
                    "reason": "session_refreshing",
                },
                "states": [],
            },
            {"reconciled": True},
            {
                "isWriteBlocked": False,
                "writeAdmission": {"open": True, "reason": None},
                "states": [
                    {
                        "kind": "event-overflow-reconcile",
                        "detail": {"staleDomains": ["social", "group"]},
                    }
                ],
            },
            {
                "isWriteBlocked": False,
                "writeAdmission": {"open": True, "reason": None},
                "states": [],
            },
            {"messageId": "message-1"},
        ]

        result = runtime.call_action(
            "sim-ios",
            "messaging.send",
            {"conversationId": "direct-1", "plaintext": "hello"},
            timeout=1,
        )

        self.assertEqual(result, {"messageId": "message-1"})
        self.assertEqual(
            runtime.mobile_binding.call_action.call_args_list,
            [
                call("sim-ios", "recovery.snapshot", {}),
                call("sim-ios", "social.reconcile", {}),
                call("sim-ios", "recovery.snapshot", {}),
                call("sim-ios", "recovery.snapshot", {}),
                call(
                    "sim-ios",
                    "messaging.send",
                    {"conversationId": "direct-1", "plaintext": "hello"},
                ),
            ],
        )

    @patch(
        "tooling.acceptance.gates.chat.mixed_native_runtime."
        "MOBILE_WRITE_ADMISSION_STABLE_SECONDS",
        0,
    )
    def test_mobile_mutation_retries_once_after_write_revocation_race(
        self,
    ) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.client_specs = {
            "sim-ios": {"runtime": "tauri-ios-simulator"},
        }
        runtime.mobile_clients = ["sim-ios"]
        runtime.mobile_binding = MagicMock()
        runtime.mobile_binding.call_action.side_effect = [
            {
                "isWriteBlocked": False,
                "writeAdmission": {"open": True, "reason": None},
                "states": [],
            },
            GateError(
                "Mobile Acceptance action 'messaging.interact' failed with "
                "mobile.recovery.writeRevocation.body"
            ),
            {
                "isWriteBlocked": True,
                "writeAdmission": {
                    "open": False,
                    "reason": "runtime_suspended",
                },
                "states": [],
            },
            {"reconciled": True},
            {
                "isWriteBlocked": False,
                "writeAdmission": {"open": True, "reason": None},
                "states": [],
            },
            {"interactionId": "reaction-1"},
        ]

        result = runtime.call_action(
            "sim-ios",
            "messaging.interact",
            {"conversationId": "group-1", "messageId": "message-1"},
            timeout=1,
        )

        self.assertEqual(result, {"interactionId": "reaction-1"})
        self.assertEqual(
            runtime.mobile_binding.call_action.call_args_list,
            [
                call("sim-ios", "recovery.snapshot", {}),
                call(
                    "sim-ios",
                    "messaging.interact",
                    {
                        "conversationId": "group-1",
                        "messageId": "message-1",
                    },
                ),
                call("sim-ios", "recovery.snapshot", {}),
                call("sim-ios", "social.reconcile", {}),
                call("sim-ios", "recovery.snapshot", {}),
                call(
                    "sim-ios",
                    "messaging.interact",
                    {
                        "conversationId": "group-1",
                        "messageId": "message-1",
                    },
                ),
            ],
        )

    def test_mobile_mutation_does_not_retry_unrelated_failure(self) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.client_specs = {
            "sim-ios": {"runtime": "tauri-ios-simulator"},
        }
        runtime.mobile_clients = ["sim-ios"]
        runtime.mobile_binding = MagicMock()
        runtime.mobile_binding.call_action.side_effect = [
            {
                "isWriteBlocked": False,
                "writeAdmission": {"open": True, "reason": None},
                "states": [],
            },
            GateError("Mobile Acceptance action failed with another error"),
        ]

        with self.assertRaisesRegex(GateError, "another error"):
            runtime.call_action(
                "sim-ios",
                "messaging.send",
                {"conversationId": "direct-1", "plaintext": "hello"},
                timeout=1,
            )

        self.assertEqual(
            runtime.mobile_binding.call_action.call_args_list,
            [
                call("sim-ios", "recovery.snapshot", {}),
                call(
                    "sim-ios",
                    "messaging.send",
                    {"conversationId": "direct-1", "plaintext": "hello"},
                ),
            ],
        )

    def test_mobile_reconnect_suspends_and_resumes_existing_runtime(self) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.client_specs = {
            "sim-ios": {"runtime": "tauri-ios-simulator"},
        }
        runtime.identities = {
            "sim-ios": MixedClientIdentity(
                client_id="sim-ios",
                actor="bob",
                runtime="tauri-ios-simulator",
                station_service_id="station-secondary",
                station_peer_id="peer-secondary",
                ptid="ptid:bob",
                account_ref="station-account:bob",
                federation_id="fed-1",
                device_id="bob-mobile-device",
            ),
        }
        runtime.call_action = MagicMock(
            side_effect=[
                None,
                None,
                {
                    "phase": "ACTIVE",
                    "activeActorPtid": "ptid:bob",
                    "activeStationPeerId": "peer-secondary",
                },
            ]
        )
        runtime.wait_until = MagicMock(
            side_effect=lambda predicate, _description, **_kwargs: predicate()
        )

        runtime.reconnect_client("sim-ios", timeout_seconds=12.0)

        self.assertEqual(
            runtime.call_action.call_args_list,
            [
                call("sim-ios", "lifecycle.suspend", {}),
                call("sim-ios", "lifecycle.resume", {}),
                call("sim-ios", "lifecycle.scope.read", {}),
            ],
        )
        runtime.wait_until.assert_called_once_with(
            ANY,
            "sim-ios authenticated after reconnect",
            timeout_seconds=12.0,
        )

    def test_cleanup_closes_mobile_ephemeral_binding_after_client_error(
        self,
    ) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.mobile_clients = ["sim-ios"]
        runtime.mobile_binding = MagicMock()
        runtime.call_action = MagicMock(
            side_effect=RuntimeError("client cleanup failed")
        )
        runtime.desktop_sessions = {}
        runtime.desktop_instances = []
        runtime.desktop_lifecycles = MagicMock()
        runtime.desktop_binding = MagicMock()
        runtime.desktop_binding.finalize_cleanup.return_value = {
            "portsReleased": True,
            "processesReleased": True,
            "storageReleased": True,
            "logsReleased": True,
            "cleanupErrors": [],
        }
        runtime.client_specs = {}

        result = runtime.cleanup()

        runtime.mobile_binding.close.assert_called_once_with()
        self.assertTrue(result["mobileSessionsReleased"])
        self.assertEqual(
            result["cleanupErrors"],
            [
                {
                    "resource": "mobile-session:sim-ios",
                    "error": "client cleanup failed",
                }
            ],
        )

    @patch(
        "tooling.acceptance.gates.chat.lifecycle_call_resolution.wait_until",
        side_effect=[
            {"state": "ringing_all_devices"},
            {
                "state": "rejected",
                "winningDeviceIdentityDigest": "mobile-device",
            },
            {"state": "handled_elsewhere"},
            {"state": "rejected"},
        ],
    )
    def test_reject_first_scenario_proves_the_competing_accept_conflict(
        self,
        _wait_until: MagicMock,
    ) -> None:
        gate = object.__new__(CallResolutionGate)
        gate.device_ids = {"sim-ios": "mobile-device"}
        gate.initiate_call = MagicMock(return_value={"callId": "call-1"})
        gate.read_call_state = MagicMock()
        gate.reject_call = MagicMock(return_value={"state": "rejected"})
        gate.accept_call = MagicMock(
            return_value={"state": "handled_elsewhere", "conflict": True}
        )
        gate.assert_condition = MagicMock()

        gate.prove_reject_before_accept(
            "desktop-alice",
            "ptid:bob",
            "sim-ios",
            "desktop-bob",
        )

        self.assertEqual(
            [item.args[0] for item in gate.assert_condition.call_args_list],
            ["reject_before_accept", "duplicate_accept_409"],
        )
        gate.accept_call.assert_called_once_with("desktop-bob", "call-1")

    @patch(
        "tooling.acceptance.gates.chat.mixed_native_runtime."
        "wait_for_peer_key_bundle"
    )
    def test_desktop_direct_waits_for_peer_key_bundle(
        self,
        wait_for_bundle: MagicMock,
    ) -> None:
        runtime = object.__new__(MixedNativeRuntime)
        runtime.identities = {
            "desktop-alice": MixedClientIdentity(
                client_id="desktop-alice",
                actor="alice",
                runtime="desktop-macos-native",
                station_service_id="station-primary",
                station_peer_id="peer-primary",
                ptid="ptid:alice",
                account_ref="station-account:alice",
                federation_id="fed-1",
                device_id="alice-device",
            ),
            "sim-ios": MixedClientIdentity(
                client_id="sim-ios",
                actor="bob",
                runtime="tauri-ios-simulator",
                station_service_id="station-secondary",
                station_peer_id="peer-secondary",
                ptid="ptid:bob",
                account_ref="station-account:bob",
                federation_id="fed-1",
                device_id="bob-mobile-device",
            ),
        }
        desktop_session = object()
        runtime.desktop_sessions = {"desktop-alice": desktop_session}
        runtime.client_specs = {
            "desktop-alice": {"runtime": "native-tauri"},
            "sim-ios": {"runtime": "tauri-ios-simulator"},
        }
        runtime.call_action = MagicMock(
            return_value={"conversationId": "conversation-1"}
        )
        runtime.wait_for_conversation = MagicMock()

        conversation_id = runtime.create_direct(
            "desktop-alice",
            "sim-ios",
            timeout_seconds=12.0,
        )

        self.assertEqual(conversation_id, "conversation-1")
        wait_for_bundle.assert_called_once_with(
            desktop_session,
            "ptid:bob",
            "peer-secondary",
            timeout=12.0,
        )


if __name__ == "__main__":
    unittest.main()
