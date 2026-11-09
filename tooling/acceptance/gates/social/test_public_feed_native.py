"""Social's concrete Native entry consumes its selected parent scope."""
import os
import runpy
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
from tooling.acceptance.gates.social.public_feed_native import GATE_ID, Gate, RUNTIME_REUSE, SCENARIOS

ROOT = Path(__file__).resolve().parents[4]


class PublicFeedNativeEntryTest(unittest.TestCase):
    def test_comment_like_timeout_preserves_original_failure_and_actual_state(self):
        for present, observation_error, capture_error in (
            (True, None, None), (False, None, None),
            (True, RuntimeError("DOM unavailable"), RuntimeError("capture unavailable")),
        ):
            with self.subTest(present=present, observation_error=observation_error is not None):
                gate = object.__new__(Gate)
                gate.active_social_scenario = "comment-reactions"
                gate.report = SimpleNamespace(runtime={})
                client = Mock()
                actual = {"present": True, "count": "1", "pressed": "true",
                          "execution": "idle", "disabled": False}
                client.execute_script.return_value = actual
                client.execute_script.side_effect = observation_error
                gate.clients = {"bob": client}
                gate.comment_selector = Mock(return_value="original-comment")
                gate.visible_element = Mock(return_value=Mock() if present else None)
                gate.action = Mock(return_value={"pendingCount": 0, "verifiedSequence": "9"})
                gate.capture = Mock(side_effect=capture_error)
                failure = GateError("original LIKE timeout")
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=failure,
                ) as wait:
                    with self.assertRaises(GateError) as caught:
                        gate.assert_comment_like("bob", "original-post", "original-comment", 2, True)
                self.assertIs(caught.exception, failure)
                self.assertEqual(wait.call_count, 1)
                self.assertEqual(wait.call_args.kwargs["timeout"], 120)
                if observation_error is None:
                    self.assertEqual(gate.report.runtime["commentLikeFailureObservations"], [{
                        "actor": "bob", "expected": {"count": 2, "liked": True},
                        "actual": actual if present else {"present": False},
                    }])
                else:
                    self.assertNotIn("commentLikeFailureObservations", gate.report.runtime)
                gate.action.assert_called_once_with("bob", "publicFeedStatus")
                self.assertEqual(gate.report.runtime["commentLikeNativeStatus"]["bob"]["pendingCount"], 0)
                gate.capture.assert_called_once_with("bob", "comment-reactions-bob-verification-failure")

    def test_settled_comment_like_does_not_add_failure_reads_or_captures(self):
        gate = object.__new__(Gate)
        gate.report = SimpleNamespace(runtime={})
        gate.comment_selector = Mock(return_value="original-comment")
        gate.action = Mock()
        gate.capture = Mock()
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            return_value=True,
        ) as wait:
            selector = gate.assert_comment_like("bob", "original-post", "original-comment", 2, True)
        self.assertIn("original-comment", selector)
        self.assertEqual(wait.call_args.kwargs["timeout"], 120)
        self.assertEqual(gate.report.runtime, {})
        gate.action.assert_not_called()
        gate.capture.assert_not_called()

    def test_poll_timeout_retains_actual_predicate_and_rendering_before_cleanup(self):
        for present, capture_error in (
            (True, None), (False, None), (True, RuntimeError("capture failed")),
        ):
            with self.subTest(present=present, capture_error=capture_error is not None):
                gate = object.__new__(Gate)
                gate.active_social_scenario = "poll-single-choice"
                gate.report = SimpleNamespace(runtime={})
                client = Mock()
                actual = {
                    "present": True, "state": "ready", "counts": [1, 1],
                    "choices": [], "voters": 2, "disabled": False,
                    "top": 40, "bottom": 300, "height": 260,
                    "viewportHeight": 600, "hitInside": True,
                }
                client.execute_script.return_value = actual
                gate.clients = {"bob": client}
                gate.visible_element = Mock(return_value=Mock() if present else None)
                gate.capture = Mock(side_effect=capture_error)
                failure = GateError("timed out waiting for bob verified poll counts and selection")
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.wait_until",
                    side_effect=failure,
                ) as wait:
                    with self.assertRaises(GateError) as caught:
                        gate.assert_poll("bob", "original-poll", "post", [1, 1], [1])
                self.assertIs(caught.exception, failure)
                self.assertEqual(wait.call_count, 1)
                self.assertEqual(wait.call_args.kwargs["timeout"], 120)
                self.assertEqual(gate.report.runtime["pollFailureObservations"], [{
                    "actor": "bob",
                    "expected": {"counts": [1, 1], "choices": [1], "closed": False},
                    "actual": actual if present else {"present": False},
                }])
                gate.capture.assert_called_once_with(
                    "bob", "poll-single-choice-bob-verification-failure")

    def test_poll_rendering_capture_is_attempted_when_state_observation_fails(self):
        gate = object.__new__(Gate)
        gate.active_social_scenario = "poll-single-choice"
        gate.report = SimpleNamespace(runtime={})
        gate.visible_element = Mock(side_effect=RuntimeError("state capture failed"))
        gate.capture = Mock()
        failure = GateError("original poll failure")
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            side_effect=failure,
        ):
            with self.assertRaises(GateError) as caught:
                gate.assert_poll("bob", "original-poll", "post", [1, 1], [1])
        self.assertIs(caught.exception, failure)
        gate.capture.assert_called_once_with(
            "bob", "poll-single-choice-bob-verification-failure")
        self.assertNotIn("pollFailureObservations", gate.report.runtime)

    def test_settled_poll_does_not_add_failure_observations_or_captures(self):
        gate = object.__new__(Gate)
        gate.report = SimpleNamespace(runtime={})
        gate.capture = Mock()
        with patch(
            "tooling.acceptance.gates.social.public_feed_native.wait_until",
            return_value=True,
        ) as wait:
            gate.assert_poll("bob", "original-poll", "post", [1, 1], [1])
        self.assertEqual(wait.call_args.kwargs["timeout"], 120)
        self.assertEqual(gate.report.runtime, {})
        gate.capture.assert_not_called()

    def test_original_circle_suite_declares_block_and_intermediate_epoch_without_extra_launches(self):
        self.assertIn("circle-block", SCENARIOS)
        self.assertIn("circle-account-epoch", SCENARIOS)
        ledger = SuiteRuntimeLedger(RUNTIME_REUSE, suite_runtime_id="circle-scope",
            source_digest="a" * 40, fixture_epoch="circle-scope")
        self.assertEqual(ledger.contract.max_client_launches, 4)
        self.assertEqual(tuple(ledger.contract.scenario_ids), SCENARIOS)

    def test_original_poll_checks_peer_availability_and_real_empty_activation(self):
        for disabled, aria_disabled, accepted in (
            (None, "true", True), ("true", None, True),
            (None, "false", False), (None, None, False),
        ):
            with self.subTest(disabled=disabled, aria_disabled=aria_disabled):
                gate = object.__new__(Gate)
                question = {"value": ""}
                publish = Mock()
                publish.get_attribute.side_effect = {
                    "disabled": disabled, "aria-disabled": aria_disabled,
                }.get
                field = Mock()
                field.get_attribute.side_effect = question.get
                card = Mock()
                card.get_attribute.return_value = "actual-object"
                lifecycle = {"open": True, "opens": 0, "reopenedReads": 0}

                def click(actor, selector):
                    if selector == '[data-action-id="compose.cancel"]':
                        lifecycle["open"] = False
                    elif selector == '[data-acceptance-id="social-composer-open"]':
                        lifecycle["open"] = True
                        lifecycle["opens"] += 1

                def visible(actor, selector):
                    if selector == 'textarea[data-moments-composer-input]':
                        return field if lifecycle["open"] else None
                    if selector.endswith('="social-poll-question"]'):
                        if lifecycle["opens"] == 2:
                            lifecycle["reopenedReads"] += 1
                            if lifecycle["reopenedReads"] == 1:
                                return None
                        return field if lifecycle["open"] else None
                    return publish

                gate.visible_element = Mock(side_effect=visible)
                gate.click = Mock(side_effect=click)
                gate.action = Mock(return_value={"pendingCount": 0, "verifiedSequence": "7"})
                gate.await_card = Mock(return_value=card)
                gate.set_input = Mock(side_effect=lambda actor, selector, value:
                    question.update(value=value) if selector.endswith('="social-poll-question"]') else None)

                def assert_condition(name, condition, *args):
                    if not condition:
                        raise GateError(name)

                gate.assert_condition = assert_condition
                if not accepted:
                    with self.assertRaisesRegex(GateError, "empty-poll-publication-disabled"):
                        gate.create_poll("original-poll")
                    gate.action.assert_not_called()
                    continue
                self.assertEqual(gate.create_poll("original-poll"), {
                    "alice": "actual-object", "bob": "actual-object",
                })
                self.assertEqual(gate.action.call_count, 2)
                self.assertEqual(lifecycle["reopenedReads"], 2)
                self.assertEqual(gate.click.call_args_list.count(
                    unittest.mock.call("alice", '[data-acceptance-id="social-composer-publish"]'),
                ), 2)

    def test_original_runner_accepts_the_capability_catalog_launch(self):
        runner = runpy.run_path(str(ROOT / "tooling/scripts/acceptance-run.py"))
        definition = runner["load_gate_definitions"](ROOT / "tooling/acceptance/gates.yaml")[GATE_ID]
        launch = runner["gate_launch_fields"](GATE_ID, definition)
        self.assertEqual(launch, {
            "argv": ["python3", "-m", "tooling.acceptance.gates.social.public_feed_native"],
            "ephemeralCapabilities": ["social-feed-notification"],
        })
        invalid = dict(definition)
        invalid["command"] = " ".join(invalid.pop("argv"))
        with self.assertRaisesRegex(SystemExit, "ephemeralCapabilities requires argv"):
            runner["gate_launch_fields"](GATE_ID, invalid)

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

    def test_original_run_retains_owned_cleanup_details_beside_primary_failure(self):
        current = source_identity(ROOT)
        gate = object.__new__(Gate)
        gate.manifest = {"source": current, "runId": "source-binding-fixture"}
        gate.actor_manifest = {"runId": "source-binding-fixture"}
        gate.active_social_scenario = None
        gate.report = SimpleNamespace(runtime={})
        cleanup = {"portsReleased": True, "processesReleased": True,
                   "storageReleased": True, "logsReleased": True,
                   "cleanupErrors": [{"resource": "session:alice", "error": "typed refusal"}]}
        with patch.object(gate, "verify_fixture_ready", side_effect=RuntimeError("fixture boundary")), \
             patch.object(gate, "cleanup_clients", return_value=cleanup):
            with self.assertRaisesRegex(RuntimeError, "fixture boundary"):
                gate.run()
        self.assertEqual(gate.report.runtime["cleanup"], cleanup)
        self.assertIn("cleanupFailure", gate.report.runtime)

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
