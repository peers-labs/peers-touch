"""Social's concrete Native entry consumes its selected parent scope."""
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.suite_runtime import SuiteRuntimeLedger, SuiteRuntimeError
from tooling.acceptance.core.e2e_preflight import (
    PREFLIGHT_ENV, load_catalog, prepare_e2e, preflight_binding,
)
from tooling.acceptance.core.evidence_store import source_identity
from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_graph import compile_graph
from tooling.acceptance.gates.social.public_feed_native import GATE_ID, Gate

ROOT = Path(__file__).resolve().parents[4]


class PublicFeedNativeEntryTest(unittest.TestCase):
    def binding(self):
        catalog = ROOT / "tooling/acceptance/gates.yaml"
        definitions = load_catalog(catalog)
        return preflight_binding(prepare_e2e(
            definitions, compile_graph(definitions, [GATE_ID]),
            source_identity(ROOT), repo_root=ROOT, catalog_path=catalog,
            execution_policy="development",
        ))

    def test_original_social_constructor_consumes_its_parent_scope(self):
        with patch.dict(os.environ, {PREFLIGHT_ENV: self.binding()}), patch.object(
            Gate, "__init__", return_value=None,
        ):
            gate = Gate()
        self.assertEqual(gate.e2e_preflight["selectedGateIds"], [GATE_ID])
        self.assertEqual(gate.e2e_preflight["dispatchGateIds"], [GATE_ID])

    def test_inherited_chat_identity_is_rejected_before_construction(self):
        with patch.dict(os.environ, {PREFLIGHT_ENV: self.binding()}), patch.object(
            Gate, "gate_id", "chat-device-search-native-e2e",
        ), patch.object(Gate, "__init__", return_value=None) as constructor:
            with self.assertRaisesRegex(ExecutionBudgetError, "outside E2E request closure"):
                Gate()
        constructor.assert_not_called()

    def test_original_run_binds_runner_workspace_digest_before_fixture_work(self):
        current = source_identity(ROOT)
        for workspace_digest, expected in (
            (current["workspaceDigest"], current["workspaceDigest"].removeprefix("sha256:")),
            ("clean", current["commit"]),
        ):
            with self.subTest(workspace_digest=workspace_digest):
                gate = object.__new__(Gate)
                gate.manifest = {
                    "source": {**current, "workspaceDigest": workspace_digest},
                    "runId": "source-binding-fixture",
                }
                gate.actor_manifest = {"runId": "source-binding-fixture"}
                gate.active_social_scenario = None
                gate.report = SimpleNamespace(runtime={})
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.SuiteRuntimeLedger",
                    wraps=SuiteRuntimeLedger,
                ) as ledger, patch.object(
                    gate, "verify_fixture_ready", side_effect=RuntimeError("fixture boundary"),
                ), patch.object(gate, "cleanup_clients", return_value={}):
                    with self.assertRaisesRegex(RuntimeError, "fixture boundary"):
                        gate.run()
                self.assertEqual(ledger.call_args.kwargs["source_digest"], expected)

    def test_original_run_rejects_invalid_workspace_digest_before_fixture_work(self):
        gate = object.__new__(Gate)
        gate.manifest = {
            "source": {"commit": "a" * 40, "workspaceDigest": "sha256:invalid"},
            "runId": "source-binding-fixture",
        }
        gate.actor_manifest = {"runId": "source-binding-fixture"}
        with patch.object(gate, "verify_fixture_ready") as fixture:
            with self.assertRaisesRegex(SuiteRuntimeError, "SUITE_RUNTIME_SOURCE_INVALID"):
                gate.run()
        fixture.assert_not_called()

    def test_station_source_uses_app_meta_contract_before_client_launch(self):
        commit = "a" * 40
        for version, accepted in (
            ({"build_commit": commit}, True),
            ({"build_commit": "b" * 40}, False),
            ({"commit": commit}, False),
            ({}, False),
        ):
            with self.subTest(version=version):
                gate = object.__new__(Gate)
                gate.manifest = {
                    "source": {"commit": commit, "workspaceDigest": "clean"},
                    "runId": "version-contract-fixture",
                }
                gate.actor_manifest = {"runId": "version-contract-fixture"}
                gate.client_specs = {
                    "alice": {"actor": "alice"},
                    "bob": {"actor": "bob"},
                    "bob2": {"actor": "bob"},
                }
                gate.active_social_scenario = None
                gate.report = SimpleNamespace(runtime={}, add_assertion=Mock())
                gate.clients = {"bob": Mock()}
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.read_station_version",
                    return_value=version,
                ), patch(
                    "tooling.acceptance.gates.social.public_feed_native.runtime_station_service",
                    side_effect=lambda manifest, actor: {
                        "endpoint": f"http://{actor}.invalid",
                        "runtimeIdentity": actor,
                    },
                ), patch.object(
                    gate, "verify_fixture_ready",
                ), patch.object(
                    gate, "start_client",
                ) as launch, patch(
                    "tooling.acceptance.gates.social.public_feed_native._prepare_portable_recovery",
                    return_value=("private-recovery-material", {"preparedEpoch": 1}),
                ) as prepare_recovery, patch.object(
                    gate, "source_identity", side_effect=RuntimeError("source identity boundary"),
                ), patch.object(gate, "cleanup_clients", return_value={}):
                    if accepted:
                        with self.assertRaisesRegex(RuntimeError, "source identity boundary"):
                            gate.run()
                        self.assertEqual(launch.call_count, 3)
                        self.assertEqual([call.args[0] for call in launch.call_args_list],
                                         ["alice", "bob", "bob2"])
                        prepare_recovery.assert_called_once()
                        self.assertTrue(callable(
                            launch.call_args_list[2].kwargs["prepare_authenticated_device"]))
                    else:
                        with self.assertRaisesRegex(GateError, "alice-station-source"):
                            gate.run()
                        launch.assert_not_called()
                        prepare_recovery.assert_not_called()

    def test_original_launch_restores_authenticated_device_before_engine_hydration(self):
        from tooling.acceptance.gates.chat.native_two_client_runner import NativeTwoClientGate

        gate = object.__new__(Gate)
        client = Mock()
        client.get_current_url.return_value = "tauri://localhost/"
        gate.runtime_binding = Mock()
        gate.runtime_binding.create_bound_session.return_value = client
        gate.client_specs = {"bob2": {"actor": "bob"}}
        gate.actor_specs = {"bob2": {
            "ptid": "ptid:bob", "accountRef": "station-account:bob",
        }}
        gate.manifest = {}
        gate.runtime_instances = []
        gate.runtime_instance_actors = {}
        gate.client_lifecycles = Mock()
        gate.station_access = {}
        gate.clients = {}
        gate.ptids = {}
        gate.device_ids = {}
        gate.account_login_client = None
        gate.report = SimpleNamespace(add_actor=Mock())
        calls = []
        recovered = False

        def harness(session, method, payload, **kwargs):
            self.assertIs(session, client)
            calls.append(method)
            if method == "loginWithPassword":
                return {"authenticated": True}
            if method == "hydrateActiveActor":
                if not recovered:
                    raise RuntimeError("messaging profile engine is not active")
                return {"actorPtid": "ptid:bob"}
            if method == "getRealtimeDevice":
                return {"active": True, "deviceId": "bob-second-device"}
            raise AssertionError(method)

        def restore(session):
            nonlocal recovered
            self.assertIs(session, client)
            gate.client_lifecycles.mark_authenticated.assert_called_once_with(client)
            calls.append("restore-original-device")
            recovered = True

        with patch.object(gate, "configure_station_access", return_value={}), patch.object(
            gate, "register_driver",
        ), patch(
            "tooling.acceptance.gates.chat.native_two_client_runner.runtime_station_service",
            return_value={"endpoint": "http://reviewed-station"},
        ), patch(
            "tooling.acceptance.gates.chat.native_two_client_runner.call_async_harness",
            return_value={"phase": "bound", "activeUrl": "http://reviewed-station"},
        ), patch(
            "tooling.acceptance.gates.chat.native_two_client_runner.async_harness",
            side_effect=harness,
        ):
            NativeTwoClientGate.start_client(
                gate, "bob2", prepare_authenticated_device=restore)
        self.assertEqual(calls, [
            "loginWithPassword", "restore-original-device",
            "hydrateActiveActor", "getRealtimeDevice",
        ])
        self.assertEqual(gate.ptids["bob2"], "ptid:bob")
        self.assertEqual(gate.device_ids["bob2"], "bob-second-device")

    def test_original_suite_recovery_failure_retains_launch_failure(self):
        gate = object.__new__(Gate)
        gate.manifest = {}
        gate.client_specs = {"alice": {}, "bob": {}, "bob2": {}}
        gate.clients = {"bob": Mock()}
        gate.report = SimpleNamespace(runtime={})
        gate.assert_condition = Mock()
        calls = []
        failure = RuntimeError("original-recovery-failure")

        def launch(actor, **kwargs):
            calls.append(actor)
            if actor == "bob2":
                kwargs["prepare_authenticated_device"](Mock())

        with patch(
            "tooling.acceptance.gates.social.public_feed_native.runtime_station_service",
            return_value={"endpoint": "http://reviewed-station"},
        ), patch(
            "tooling.acceptance.gates.social.public_feed_native.read_station_version",
            return_value={"build_commit": "a" * 40},
        ), patch(
            "tooling.acceptance.gates.social.public_feed_native._prepare_portable_recovery",
            return_value=("private-recovery-material", {"preparedEpoch": 1}),
        ), patch(
            "tooling.acceptance.gates.social.public_feed_native._restore_portable_recovery",
            side_effect=failure,
        ), patch.object(gate, "start_client", side_effect=launch):
            with self.assertRaises(RuntimeError) as raised:
                gate.start_suite_clients(Mock(), "a" * 40)
        self.assertIs(raised.exception, failure)
        self.assertEqual(calls, ["alice", "bob", "bob2"])
        self.assertNotIn("secondDeviceRecovery", gate.report.runtime)


if __name__ == "__main__":
    unittest.main()
