from __future__ import annotations

import inspect
import unittest
from unittest.mock import Mock, patch

from tooling.acceptance.core import (
    DriverError,
    GateError,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.mobile.simulator_social_e2e import (
    ENVIRONMENT_ID,
    IOS_SOCIAL_ENVIRONMENT_ID,
    IOS_SOCIAL_PARITY_SCENARIOS,
    IOS_SOCIAL_RUNTIME_REUSE,
    SCENARIO_GATES,
    SimulatorSocialGate,
)
from tooling.acceptance.gates.mobile.simulator_e2e import SimulatorGateBlocked
from tooling.acceptance.gates.mobile.messaging_journey import MessagingActor
from tooling.acceptance.provisioners.mobile_simulator import (
    MobileSocialIOSSimulatorProvisioner,
)


class Artifacts:
    run_id = "20260904T120000000000Z-" + ("1" * 32)

    class Store:
        workspace_id = "a" * 16

    store = Store()

    def __init__(self) -> None:
        self.completed: dict[str, object] = {}
        self.writes: list[tuple[str, object, str | None]] = []

    def __enter__(self) -> "Artifacts":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def write_json(
        self,
        path: str,
        value: object,
        *,
        role: str | None = None,
    ) -> None:
        self.writes.append((path, value, role))

    def complete(self, **values: object) -> None:
        self.completed = values


class SimulatorSocialGateTests(unittest.TestCase):
    def test_search_selects_bound_federation_before_submitting(self) -> None:
        gate = SimulatorSocialGate("ios-social-parity")
        session = Mock()
        receiver = self._actor("sim-ios-peer", "bob")
        selected = False

        def select_radio(
            _session: object,
            control_selector: str,
            selector: str,
            enabled_selector: str,
            _label: str,
        ) -> int:
            nonlocal selected
            self.assertIn("label.ant-radio-wrapper:has(", control_selector)
            self.assertIn(f'value="{receiver.federation_id}"', selector)
            self.assertIn(".ant-input-search-btn", enabled_selector)
            selected = True
            return 7

        def click(_session: object, selector: str, _label: str) -> None:
            if ".ant-input-search-btn" in selector:
                self.assertTrue(selected, "search cannot submit without a Federation")

        def set_value(
            _session: object,
            selector: str,
            value: str,
            _label: str,
        ) -> None:
            if "social-search-input" in selector:
                self.assertEqual(value, receiver.role)

        with (
            patch.object(gate, "_wait_ui"),
            patch.object(gate, "_set_ui_value", side_effect=set_value),
            patch.object(gate, "_select_radio", side_effect=select_radio),
            patch.object(gate, "_click_ui", side_effect=click),
        ):
            result = gate._run_ios_search_profile(session, receiver)
        self.assertTrue(selected)
        self.assertEqual(result["receiverAssertion"], f"profile-visible:{receiver.ptid}")

    def test_select_radio_operates_visible_control_and_waits_for_checked(self) -> None:
        session = Mock()
        session.execute_script.side_effect = [None, {"index": 3}]
        session.find_element.return_value = "radio-element"

        index = SimulatorSocialGate._select_radio(
            session,
            'label.ant-radio-wrapper:has(input[value="federation-1"])',
            'input[type="radio"][value="federation-1"]',
            ".search-submit",
            "Federation",
        )

        session.find_element.assert_called_once_with(
            "css selector",
            'label.ant-radio-wrapper:has(input[value="federation-1"])',
        )
        session.click_element.assert_called_once_with("radio-element")
        self.assertEqual(session.execute_script.call_count, 2)
        script = session.execute_script.call_args_list[0].args[0]
        self.assertIn("input?.checked !== true", script)
        self.assertIn("enabled?.disabled !== false", script)
        self.assertEqual(index, 3)

    def test_select_antd_option_opens_current_root_control(self) -> None:
        session = Mock()
        session.find_element.return_value = "select-element"
        session.execute_script.return_value = True
        gate = SimulatorSocialGate("ios-social-parity")

        gate._select_antd_option(
            session,
            '[data-acceptance-id="picker"] .ant-select',
            3,
            "Federation",
        )

        session.find_element.assert_called_once_with(
            "css selector",
            '[data-acceptance-id="picker"] .ant-select',
        )
        session.click_element.assert_called_once_with("select-element")
        self.assertEqual(session.execute_script.call_args.args[1], 3)

    def test_post_action_uses_webdriver_element_click(self) -> None:
        session = Mock()
        session.find_element.return_value = "post-action"

        SimulatorSocialGate._click_ui_for_post(
            session,
            "01M59ASBXMEH91RATX66HFYMEZ",
            "social-thread-open",
            "Moment thread",
        )

        session.find_element.assert_called_once_with(
            "css selector",
            (
                '[data-acceptance-id="social-moment-card"]'
                '[data-post-id="01M59ASBXMEH91RATX66HFYMEZ"] '
                '[data-acceptance-id="social-thread-open"]'
            ),
        )
        session.click_element.assert_called_once_with("post-action")
        session.execute_script.assert_not_called()

    def test_ios_reuses_the_open_product_reaction_picker(self) -> None:
        source = inspect.getsource(
            SimulatorSocialGate._run_ios_thread_reaction
        )

        self.assertLess(
            IOS_SOCIAL_PARITY_SCENARIOS.index("rc01-thread-reaction"),
            IOS_SOCIAL_PARITY_SCENARIOS.index("rc01-circles-publish"),
        )
        self.assertEqual(source.count('"social-reaction-open"'), 1)
        self.assertIn('state.get("publicPostId")', source)
        self.assertIn('"moments.comment"', source)
        self.assertIn("data-reaction-picker-item", source)
        self.assertNotIn("moments.private.comment.submit", source)
        self.assertNotIn("social-reaction-choice", source)

    def test_moment_thread_diagnostic_exposes_only_structural_counts(self) -> None:
        session = Mock()
        session.execute_script.return_value = {
            "momentsPages": 1,
            "cards": 1,
            "actions": 1,
            "threads": 0,
            "rootError": "TypeError: render failed",
        }

        state = SimulatorSocialGate._moment_thread_state(
            session,
            "01M59ASBXMEH91RATX66HFYMEZ",
        )

        self.assertEqual(
            state,
            {
                "momentsPages": 1,
                "cards": 1,
                "actions": 1,
                "threads": 0,
                "rootError": "TypeError: render failed",
            },
        )
        self.assertNotIn(
            "01M59ASBXMEH91RATX66HFYMEZ",
            str(state),
        )

    def test_circle_audience_selects_the_created_circle_row(self) -> None:
        gate = SimulatorSocialGate("ios-social-parity")
        sender_session = Mock()
        sender_session.call_action.return_value = {"publish": []}
        receiver_session = Mock()
        receiver = self._actor("sim-ios-peer", "bob")

        with (
            patch.object(gate, "_wait_ui"),
            patch.object(gate, "_set_ui_value"),
            patch.object(gate, "_select_antd_option"),
            patch.object(
                gate,
                "_wait_ui_attribute_value",
                return_value="circle-42",
            ),
            patch.object(gate, "_wait_ui_text"),
            patch.object(
                gate,
                "_wait_ui_attribute",
                side_effect=RuntimeError("stop after circle target"),
            ),
            patch.object(gate, "_click_ui") as click,
        ):
            with self.assertRaisesRegex(RuntimeError, "stop after circle target"):
                gate._run_ios_circles_publish(
                    sender_session,
                    receiver_session,
                    receiver,
                    "journey-1",
                    {},
                )

        clicked_selectors = [call.args[1] for call in click.call_args_list]
        self.assertIn(
            (
                '[data-acceptance-id="social-audience-circle"]'
                '[data-circle-id="circle-42"]'
            ),
            clicked_selectors,
        )
        self.assertNotIn(
            '[data-acceptance-id="social-audience-target-done"]',
            clicked_selectors,
        )

    def test_private_key_fixture_prepares_and_reconciles_each_inventory(self) -> None:
        session = Mock(client_id="sim-ios")
        session.call_action.side_effect = [
            {
                "endpointPrekeysAvailable": 100,
                "recoveryPrekeysAvailable": 16,
            },
            {
                "report": {
                    "endpointPrekeysAvailable": 100,
                    "recoveryPrekeysAvailable": 16,
                },
            },
        ]

        inventory = SimulatorSocialGate._prepare_private_keys(session)

        self.assertEqual(
            [item.args[0] for item in session.call_action.call_args_list],
            [
                "moments.private.acceptance.prepareKeys",
                "moments.private.reconcile",
            ],
        )
        self.assertEqual(
            inventory,
            {
                "endpointPrekeysAvailable": 100,
                "recoveryPrekeysAvailable": 16,
            },
        )

    def test_identity_preparation_reuses_one_channel_for_all_actors(self) -> None:
        gate = SimulatorSocialGate("ios-social-parity")
        client = Mock()
        client.invoke.return_value = {"prepared": True}
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e."
            "EphemeralGateClient.from_environment",
            return_value=client,
        ) as bind:
            for client_id, role in (
                ("sim-ios", "alice"),
                ("sim-ios-peer", "bob"),
                ("sim-ios", "eve"),
            ):
                session = Mock(client_id=client_id, session_id="owned-session")
                gate._prepare_actor_identity(session, role)
        bind.assert_called_once_with()
        self.assertEqual(
            [call.args[2]["role"] for call in client.invoke.call_args_list],
            ["alice", "bob", "eve"],
        )
        client.close.assert_not_called()

    def test_capability_channel_closes_after_failed_journey_cleanup(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("ios-social-parity")
        client = Mock()
        gate.capability_client = client
        order = []
        client.close.side_effect = lambda: order.append("channel")
        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession", return_value=artifacts,
            ),
            patch.object(gate, "_load_social_manifest", return_value={}),
            patch.object(
                gate, "_run_social_journey", side_effect=GateError("journey failed"),
            ),
            patch.object(gate, "_capture_runtime_failure", return_value=[]),
            patch.object(
                gate, "_cleanup_sessions",
                side_effect=lambda _: order.append("sessions"),
            ),
        ):
            self.assertEqual(gate.execute(), 1)
        self.assertEqual(order, ["sessions", "channel"])
        client.close.assert_called_once_with()
        self.assertIsNone(gate.capability_client)
        self.assertEqual(gate.cleanup[-1]["status"], "passed")

    @staticmethod
    def _actor(client_id: str, role: str) -> MessagingActor:
        return MessagingActor(
            client_id=client_id,
            role=role,
            station_url="https://station.example.test",
            station_peer_id="station-peer",
            ptid=f"ptid:{role}",
            account_ref=f"station-account:{role}",
            federated_handle=f"@{role}@station.example.test",
            federation_id="federation-1",
        )

    def test_capture_rejects_chat_render_error_after_preserving_evidence(self) -> None:
        artifacts = Mock()
        artifact_ref = Mock()
        artifact_ref.to_dict.return_value = {"path": "captured"}
        artifacts.write_bytes.return_value = artifact_ref
        session = Mock()
        session.screenshot_bytes.return_value = b"png"
        session.get_page_source.return_value = (
            '<section data-testid="chat-render-error">'
            "Chat could not be displayed.</section>"
        )

        with self.assertRaisesRegex(
            GateError,
            "sim-ios rendered the Mobile Chat error boundary",
        ):
            SimulatorSocialGate("chat-contacts")._capture_client(
                artifacts,
                session,
                "sim-ios",
            )

        self.assertEqual(artifacts.write_bytes.call_count, 2)

    def test_failure_diagnostics_exclude_actor_and_cursor_state(self) -> None:
        artifacts = Mock()
        artifacts.write_json.return_value.to_dict.return_value = {
            "path": "failure-runtime.json",
        }
        session = Mock(client_id="sim-ios")
        session.call_action.side_effect = [
            {
                "phase": "ACTIVE",
                "generation": 3,
                "runtimes": [
                    {"id": "messaging", "status": "failed"},
                ],
                "runtimeErrors": [
                    {
                        "runtimeId": "messaging",
                        "error": "ACTOR_IDENTITY_CONTINUITY_CONFLICT",
                    },
                ],
                "activeActorPtid": "private-actor",
            },
            {
                "active": False,
                "activeSessionUlid": "private-session",
                "friendRequests": [{"senderPtid": "private-actor"}],
                "ingress": {
                    "lifecycle": "active",
                    "writeAdmissionOpen": False,
                    "streamCursor": "private-cursor",
                },
            },
            {
                "actorPtid": "private-actor",
                "publish": [
                    {
                        "draftId": "private-draft",
                        "audienceKind": "CIRCLE",
                        "state": "PUBLISH_FAILED",
                        "errorCode": "SOCIAL_20008",
                    },
                ],
                "publishStateHistory": [
                    "CHECKING_PRIVATE_READINESS",
                    "PUBLISH_FAILED",
                ],
                "report": {
                    "submissionsProcessed": 0,
                    "submissionsUnknown": 0,
                    "submissionsTerminal": 1,
                },
                "errorPresent": True,
            },
        ]
        gate = SimulatorSocialGate("ios-social-parity")
        gate.sessions.append(session)

        result = gate._capture_runtime_failure(artifacts)

        self.assertEqual(result[0]["clientId"], "sim-ios")
        value = artifacts.write_json.call_args.args[1]
        self.assertNotIn("activeActorPtid", value["lifecycle"])
        self.assertNotIn("activeSessionUlid", value["social"])
        self.assertNotIn("friendRequests", value["social"])
        self.assertNotIn("streamCursor", value["social"]["ingress"])
        self.assertNotIn("actorPtid", value["privateSocial"])
        self.assertNotIn("draftId", value["privateSocial"]["publish"][0])
        self.assertEqual(
            value["privateSocial"]["publish"][0],
            {
                "audienceKind": "CIRCLE",
                "state": "PUBLISH_FAILED",
                "errorCode": "SOCIAL_20008",
            },
        )
        self.assertEqual(
            value["lifecycle"]["runtimeErrors"][0]["error"],
            "ACTOR_IDENTITY_CONTINUITY_CONFLICT",
        )

    def test_each_client_failure_has_one_distinct_evidence_role(self) -> None:
        artifacts = Mock()
        gate = SimulatorSocialGate("ios-social-parity")
        for client_id in ("sim-ios", "sim-ios-peer"):
            session = Mock(client_id=client_id)
            session.call_action.side_effect = [
                {"phase": "ACTIVE", "runtimes": [], "runtimeErrors": []},
                {"active": False, "ingress": None},
                {
                    "publish": [],
                    "publishStateHistory": [],
                    "report": None,
                    "errorPresent": False,
                },
            ]
            gate.sessions.append(session)

        diagnostics = gate._capture_runtime_failure(artifacts)

        roles = [
            call.kwargs["role"]
            for call in artifacts.write_json.call_args_list
        ]
        self.assertEqual(len(set(roles)), 2)
        self.assertTrue(all("artifact" in item for item in diagnostics))

    def test_failure_diagnostic_error_remains_supporting_only(self) -> None:
        artifacts = Mock()
        session = Mock(client_id="sim-ios")
        session.call_action.side_effect = DriverError("session closed")
        gate = SimulatorSocialGate("ios-social-parity")
        gate.sessions.append(session)

        self.assertEqual(
            gate._capture_runtime_failure(artifacts),
            [{"clientId": "sim-ios", "captureErrorType": "DriverError"}],
        )
        artifacts.write_json.assert_not_called()

    def test_canonical_simulator_gate_claims_declared_proof(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")
        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch.object(
                gate,
                "_run_social_journey",
                return_value=gate._result_base("PASS"),
            ),
            patch.object(gate, "_cleanup_sessions"),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 0)
        self.assertEqual(artifacts.completed["status"], "PASS")
        self.assertEqual(artifacts.completed["completion_status"], "DONE")
        self.assertEqual(artifacts.completed["proof_status"], "PROVEN")
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(
            result["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(result["gateId"], gate.gate_id)
        self.assertEqual(result["phase"], "W5 Simulator Social Convergence")
        self.assertEqual(result["bom"], ["W5", "W5-OWNER"])
        self.assertEqual(result["spec"], ["MS-AG06"])
        self.assertEqual(result["gate"], gate.gate_id)
        self.assertFalse(result["physicalDeviceClaimed"])
        self.assertIn(
            "physical-device hardware behavior",
            result["unprovenScope"],
        )

    def test_cleanup_failure_does_not_hide_primary_failure(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")

        def record_cleanup_failure(_artifacts: Artifacts) -> None:
            gate.cleanup.append(
                {
                    "clientId": "sim-ios",
                    "resource": "product-harness",
                    "status": "failed",
                    "errorType": "DriverError",
                }
            )

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch.object(
                gate,
                "_run_social_journey",
                side_effect=DriverError("station.add failed"),
            ),
            patch.object(
                gate,
                "_cleanup_sessions",
                side_effect=record_cleanup_failure,
            ),
        ):
            exit_code = gate.execute()

        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(result["reason"], "station.add failed")
        self.assertEqual(
            result["cleanupReason"],
            "simulator social cleanup was incomplete",
        )

    def test_gate_ids_are_stable_and_scenario_specific(self) -> None:
        self.assertEqual(
            SCENARIO_GATES,
            {
                "ios-social-parity": "mobile-social-ios-native",
                "social-convergence": (
                    "mobile-simulator-social-convergence-e2e"
                ),
                "chat-contacts": "mobile-simulator-chat-contacts-e2e",
                "recovery": "mobile-simulator-recovery-e2e",
                "recovery-ui": "mobile-simulator-recovery-ui-e2e",
                "moments": "mobile-simulator-moments-e2e",
                "storage-cache-cleanup": "chat-storage-cache-clear-e2e",
                "storage-batch-clear": (
                    "chat-storage-mobile-batch-clear-e2e"
                ),
                "storage-conversation-clear": (
                    "chat-storage-delete-reclaim-e2e"
                ),
                "storage-retention": "chat-storage-retention-e2e",
            },
        )
        self.assertNotEqual(
            SimulatorSocialGate("social-convergence").gate_id,
            SimulatorSocialGate("chat-contacts").gate_id,
        )

    def test_ios_social_parity_declares_one_reusable_runtime(self) -> None:
        self.assertEqual(
            IOS_SOCIAL_RUNTIME_REUSE.scenario_ids,
            IOS_SOCIAL_PARITY_SCENARIOS,
        )
        self.assertEqual(
            IOS_SOCIAL_RUNTIME_REUSE.max_provisioning_runs,
            1,
        )
        self.assertEqual(
            IOS_SOCIAL_RUNTIME_REUSE.max_client_launches,
            2,
        )
        self.assertGreaterEqual(
            IOS_SOCIAL_RUNTIME_REUSE.min_warm_reuse_rate,
            0.8,
        )
        self.assertEqual(
            MobileSocialIOSSimulatorProvisioner
            .additional_fixture_roles_by_gate["mobile-social-ios-native"],
            ("eve",),
        )
        self.assertTrue(
            MobileSocialIOSSimulatorProvisioner.requires_actor_reset,
        )
        self.assertEqual(
            SimulatorSocialGate("ios-social-parity").environment_id,
            IOS_SOCIAL_ENVIRONMENT_ID,
        )

    def test_active_scenario_cleanup_preserves_failed_suite_report(self) -> None:
        gate = SimulatorSocialGate("ios-social-parity")
        ledger = SuiteRuntimeLedger(
            IOS_SOCIAL_RUNTIME_REUSE,
            suite_runtime_id="mps-09-test",
            source_digest="a" * 40,
            fixture_epoch="fixture-test",
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="mobile-social-ios-simulator:test",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=IOS_SOCIAL_PARITY_SCENARIOS[0],
        )
        gate.suite_runtime_ledger = ledger

        report, cleanup_error = gate._finalize_suite_runtime(
            cleanup_failed=False,
        )

        self.assertIsNotNone(report)
        assert report is not None
        self.assertEqual(report["result"], "FAIL")
        self.assertEqual(
            report["events"][-1]["action"],
            SuiteRuntimeAction.SCENARIO_START.value,
        )
        self.assertIn("SUITE_RUNTIME_CLEANUP_INVALID", cleanup_error)
        self.assertEqual(
            report["findings"][-1]["code"],
            "SUITE_CLEANUP_INCOMPLETE",
        )

    def test_ios_social_parity_records_each_scenario_once(self) -> None:
        gate = SimulatorSocialGate("ios-social-parity")
        result = {
            "uiAction": "ui",
            "receiverAssertion": "receiver",
            "supportingObservation": "supporting",
        }
        with (
            patch.object(
                gate,
                "_run_ios_home_explore",
                return_value=result,
            ),
            patch.object(
                gate,
                "_run_ios_search_profile",
                return_value=result,
            ),
            patch.object(
                gate,
                "_run_ios_circles_publish",
                return_value=result,
            ),
            patch.object(
                gate,
                "_run_ios_thread_reaction",
                return_value=result,
            ),
            patch.object(
                gate,
                "_run_ios_recovery_lifecycle",
                return_value=result,
            ),
            patch.object(
                gate,
                "_run_ios_native_quality",
                return_value=result,
            ),
            patch.object(
                gate,
                "_prepare_private_keys",
                return_value={
                    "endpointPrekeysAvailable": 100,
                    "recoveryPrekeysAvailable": 16,
                },
            ),
        ):
            suite = gate._run_ios_social_parity_suite(
                manifest={"runId": "fixture-epoch"},
                source_identity={"commit": "a" * 40},
                sessions={
                    "sim-ios": object(),
                    "sim-ios-peer": object(),
                },
                actors={
                    "sim-ios": self._actor("sim-ios", "alice"),
                    "sim-ios-peer": self._actor(
                        "sim-ios-peer",
                        "bob",
                    ),
                    "fixture-eve": self._actor("sim-ios", "eve"),
                },
                journey=object(),  # type: ignore[arg-type]
                journey_id="journey",
            )

        self.assertEqual(
            [entry["scenarioId"] for entry in suite["scenarios"]],
            list(IOS_SOCIAL_PARITY_SCENARIOS),
        )
        self.assertIsNotNone(gate.suite_runtime_ledger)
        gate.suite_runtime_ledger.record(
            SuiteRuntimeAction.CLEANUP_COMPLETE,
        )
        report = gate.suite_runtime_ledger.require_valid()
        self.assertEqual(report["metrics"]["provisioningRuns"], 1)
        self.assertEqual(report["metrics"]["clientLaunches"], 2)
        self.assertEqual(report["metrics"]["completedScenarios"], 6)

    def test_explore_sort_requires_the_visible_sheet_before_selection(self) -> None:
        gate = SimulatorSocialGate("ios-social-parity")
        sender = Mock()
        sender.call_action.return_value = {"postId": "public-post"}
        receiver = Mock()
        sort_sheet_open = False
        hot_selected = False

        def click_visible(_script: str, selector: str) -> bool:
            nonlocal sort_sheet_open, hot_selected
            if selector.endswith('social-explore-sort-open"]'):
                sort_sheet_open = True
            elif selector.endswith('social-explore-sort-hot"]'):
                if not sort_sheet_open:
                    raise GateError("sort option is not on the visible surface")
                hot_selected = True
                sort_sheet_open = False
            return True

        receiver.execute_script.side_effect = click_visible
        with (
            patch.object(gate, "_wait_ui"),
            patch.object(gate, "_wait_ui_attribute"),
            patch.object(gate, "_wait_for_moment", return_value={"found": True}),
            patch.object(gate, "_wait_post_visible"),
        ):
            result = gate._run_ios_home_explore(
                sender,
                receiver,
                self._actor("sim-ios", "alice"),
                "journey",
                {},
            )

        self.assertTrue(hot_selected)
        self.assertFalse(sort_sheet_open)
        self.assertEqual(
            result["receiverAssertion"],
            "receiver-post:public-post",
        )

    def test_missing_runtime_manifest_blocks_before_journey(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                side_effect=SimulatorGateBlocked(
                    "runtime manifest missing",
                    f"{ENVIRONMENT_ID}:manifest",
                ),
            ) as load_manifest,
            patch.object(gate, "_run_social_journey") as run_journey,
            patch.object(gate, "_cleanup_sessions"),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 2)
        load_manifest.assert_called_once()
        run_journey.assert_not_called()
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(
            result["blockedResource"],
            f"{ENVIRONMENT_ID}:manifest",
        )

    def test_runtime_manifest_requires_only_same_station_service(self) -> None:
        gate = SimulatorSocialGate("recovery")

        with (
            patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/direct.json"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "load_runtime_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "require_runtime_service",
            ) as require_service,
        ):
            manifest = gate._load_social_manifest()

        self.assertEqual(manifest["environmentId"], ENVIRONMENT_ID)
        require_service.assert_called_once_with(
            manifest,
            "station",
            "station",
        )

    def test_cross_station_manifest_cannot_satisfy_direct_gate(self) -> None:
        gate = SimulatorSocialGate("recovery")

        with (
            patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/social.json"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "load_runtime_manifest",
                return_value={"environmentId": "mobile-social-simulator"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "require_runtime_service",
            ),
        ):
            with self.assertRaisesRegex(
                SimulatorGateBlocked,
                ENVIRONMENT_ID,
            ):
                gate._load_social_manifest()

    def test_ios_social_parity_requires_non_destructive_environment(
        self,
    ) -> None:
        gate = SimulatorSocialGate("ios-social-parity")

        with (
            patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/ios-social.json"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "load_runtime_manifest",
                return_value={"environmentId": IOS_SOCIAL_ENVIRONMENT_ID},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "require_runtime_service",
            ) as require_service,
        ):
            manifest = gate._load_social_manifest()

        self.assertEqual(
            manifest["environmentId"],
            IOS_SOCIAL_ENVIRONMENT_ID,
        )
        require_service.assert_called_once_with(
            manifest,
            "station",
            "station",
        )

    def test_unknown_scenario_fails_before_runtime_allocation(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported"):
            SimulatorSocialGate("unknown")

    def test_recovery_ui_uses_restart_and_authoritative_draft_readback(
        self,
    ) -> None:
        draft = {
            "kind": "chat",
            "targetId": "recovery-ui-run",
            "payloadSha256": "a" * 64,
        }

        class Session:
            def call_action(
                self,
                action: str,
                _payload: object = None,
            ) -> object:
                if action == "reliability.draft.write":
                    return draft
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "recovery.snapshot":
                    return {
                        "states": [{
                            "kind": "draft-restore-pending",
                            "actions": ["restore", "discard"],
                        }],
                    }
                if action == "reliability.snapshot":
                    return {
                        "runtime": {},
                        "commands": [],
                        "drafts": [draft],
                        "checkpoints": [],
                    }
                raise AssertionError(action)

        result = SimulatorSocialGate(
            "recovery-ui"
        )._run_recovery_ui_journey(
            session=Session(),
            journey_id="run",
        )

        self.assertEqual(result["visibleState"], "draft-restore-pending")
        self.assertEqual(result["actions"], ["restore", "discard"])

    def test_ios_waits_for_durable_moment_draft_before_restart(self) -> None:
        source = inspect.getsource(
            SimulatorSocialGate._run_ios_recovery_lifecycle
        )

        self.assertIn('"data-draft-persisted"', source)
        self.assertIn('"true"', source)
        restart = source.index('"lifecycle.restart"')
        restore = source.index('"recovery-draft-restore-action"')
        renavigate = source.index('"navigation.apply"', restore)
        reopen = source.index('"social-composer-open"', restore)
        restored_text = source.index('"Restored Moment draft"')
        self.assertLess(restart, restore)
        self.assertLess(restore, renavigate)
        self.assertLess(renavigate, reopen)
        self.assertLess(reopen, restored_text)
        self.assertNotIn("time.sleep", source)

    def test_storage_cache_cleanup_requires_physical_release_and_preserves_draft(
        self,
    ) -> None:
        draft = {
            "kind": "chat",
            "targetId": "storage-run-draft",
            "payloadSha256": "c" * 64,
        }

        class Session:
            def __init__(self) -> None:
                self.refresh_attempts = 0
                self.snapshots = [
                    {
                        "physicalTotalBytes": 3_000_000,
                        "cacheBytes": 2_100_000,
                        "confirmVisible": False,
                        "resultState": "",
                        "releasedBytes": 0,
                    },
                    {
                        "physicalTotalBytes": 3_000_000,
                        "cacheBytes": 2_100_000,
                        "confirmVisible": True,
                        "resultState": "",
                        "releasedBytes": 0,
                    },
                    {
                        "physicalTotalBytes": 800_000,
                        "cacheBytes": 0,
                        "confirmVisible": False,
                        "resultState": "succeeded",
                        "releasedBytes": 2_200_000,
                    },
                ]

            def call_action(
                self,
                action: str,
                _payload: object = None,
            ) -> object:
                if action == "storage.cache.seed":
                    return {"sizeBytes": 2 * 1024 * 1024}
                if action == "reliability.draft.write":
                    return draft
                if action == "reliability.draft.read":
                    return [draft]
                if action == "reliability.draft.action":
                    return {"drafts": []}
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action == "navigation.apply":
                    return {}
                raise AssertionError(action)

            def execute_script(self, script: str) -> object:
                if "data-chat-storage-refresh" in script:
                    self.refresh_attempts += 1
                    return self.refresh_attempts >= 3
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                return True

        session = Session()
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-cache-cleanup"
            )._run_storage_cache_cleanup_journey(
                session=session,
                journey_id="run",
            )

        self.assertEqual(session.refresh_attempts, 3)
        self.assertEqual(result["releasedBytes"], 2_200_000)
        self.assertTrue(result["draftPreserved"])
        self.assertTrue(result["messagingIdentityPreserved"])
        self.assertTrue(result["confirmationObserved"])

    def test_storage_conversation_clear_requires_reclaim_and_restart_absence(
        self,
    ) -> None:
        fixture = {
            "conversationId": "conversation-clear",
            "messageId": "message-clear",
        }

        class Session:
            def __init__(self) -> None:
                self.projection_reads = 0
                self.snapshots = [
                    {
                        "physicalTotalBytes": 4_000_000,
                        "messageBytes": 2_100_000,
                        "conversationIds": ["conversation-clear"],
                    },
                    {
                        "physicalTotalBytes": 1_500_000,
                        "messageBytes": 0,
                        "conversationIds": [],
                    },
                ]

            def call_action(self, action: str, payload: object = None) -> object:
                if action == "storage.conversation-clear.seed":
                    return fixture
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action in {"navigation.apply", "messaging.reconcile"}:
                    return {}
                if action == "messaging.projection.read":
                    self.projection_reads += 1
                    messages = (
                        [{"messageId": "message-clear"}]
                        if self.projection_reads == 1
                        else []
                    )
                    return {
                        "messages": {"conversation-clear": messages},
                    }
                if action == "messaging.search":
                    return []
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                raise AssertionError((action, payload))

            def execute_script(self, script: str) -> object:
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                if "data-chat-conversation-clear-result" in script:
                    return {"releasedBytes": 2_500_000}
                return True

        session = Session()
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-conversation-clear"
            )._run_storage_conversation_clear_journey(
                session=session,
                journey_id="run",
            )

        self.assertEqual(result["releasedBytes"], 2_500_000)
        self.assertTrue(result["plaintextAbsent"])
        self.assertTrue(result["searchEntryAbsent"])
        self.assertTrue(result["restartStable"])
        self.assertTrue(result["messagingIdentityPreserved"])

    def test_storage_batch_clear_requires_two_selected_restart_stable_items(
        self,
    ) -> None:
        fixtures = [
            {
                "conversationId": f"conversation-clear-{suffix}",
                "messageId": f"message-clear-{suffix}",
            }
            for suffix in ("a", "b", "c", "d", "e", "f", "g")
        ]

        class Session:
            def __init__(self) -> None:
                self.seed_index = 0
                self.success_result_index = 0
                self.progress_index = 0
                self.search_query = ""
                self.selected: set[str] = set()
                self.snapshots = [
                    {
                        "physicalTotalBytes": 10_000_000,
                        "messageBytes": 6_300_000,
                        "conversationIds": [
                            "conversation-clear-a",
                            "conversation-clear-b",
                            "conversation-clear-c",
                        ],
                        "conversationReclaimableBytes": {
                            "conversation-clear-a": 2_100_000,
                            "conversation-clear-b": 2_100_000,
                            "conversation-clear-c": 2_100_000,
                        },
                    },
                    {
                        "physicalTotalBytes": 8_000_000,
                        "messageBytes": 6_300_000,
                        "conversationIds": [
                            "conversation-clear-c",
                            "conversation-clear-d",
                            "conversation-clear-e",
                        ],
                        "conversationReclaimableBytes": {
                            "conversation-clear-c": 2_100_000,
                            "conversation-clear-d": 2_100_000,
                            "conversation-clear-e": 2_100_000,
                        },
                    },
                    {
                        "physicalTotalBytes": 6_000_000,
                        "messageBytes": 6_300_000,
                        "conversationIds": [
                            "conversation-clear-c",
                            "conversation-clear-f",
                            "conversation-clear-g",
                        ],
                        "conversationReclaimableBytes": {
                            "conversation-clear-c": 2_100_000,
                            "conversation-clear-f": 2_100_000,
                            "conversation-clear-g": 2_100_000,
                        },
                    },
                    {
                        "physicalTotalBytes": 4_000_000,
                        "messageBytes": 4_200_000,
                        "conversationIds": [
                            "conversation-clear-c",
                            "conversation-clear-f",
                            "conversation-clear-g",
                        ],
                        "conversationReclaimableBytes": {
                            "conversation-clear-c": 2_100_000,
                            "conversation-clear-f": 0,
                            "conversation-clear-g": 2_100_000,
                        },
                    },
                    {
                        "physicalTotalBytes": 3_000_000,
                        "messageBytes": 2_100_000,
                        "conversationIds": ["conversation-clear-c"],
                        "conversationReclaimableBytes": {
                            "conversation-clear-c": 2_100_000,
                        },
                    },
                ]

            def call_action(self, action: str, payload: object = None) -> object:
                if action == "storage.conversation-clear.seed":
                    fixture = fixtures[self.seed_index]
                    self.seed_index += 1
                    return fixture
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action in {
                    "navigation.apply",
                    "messaging.reconcile",
                }:
                    return {}
                if action == "storage.batch.scenario":
                    return {"configured": True}
                if action == "messaging.projection.read":
                    conversation_id = payload["conversationId"]
                    messages = (
                        [{"messageId": "message-clear-c"}]
                        if conversation_id == "conversation-clear-c"
                        else []
                    )
                    return {"messages": {conversation_id: messages}}
                if action == "messaging.search":
                    return (
                        [{"messageId": "message-clear-c"}]
                        if payload["conversationId"] == "conversation-clear-c"
                        else []
                    )
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                raise AssertionError((action, payload))

            def execute_script(self, script: str, *args: object) -> object:
                if "actions: Boolean" in script:
                    return {
                        "actions": False,
                        "result": False,
                        "summary": False,
                    }
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                if (
                    "data-chat-storage-search" in script
                    and "dispatchEvent" in script
                ):
                    self.search_query = str(args[0])
                    return True
                if (
                    "data-chat-storage-batch-select-all" in script
                    and "checkbox.click()" in script
                ):
                    self.selected.add("conversation-clear-a")
                    return True
                if "visibleIds:" in script:
                    visible_ids = (
                        ["conversation-clear-a"]
                        if self.search_query
                        else [
                            "conversation-clear-a",
                            "conversation-clear-b",
                            "conversation-clear-c",
                        ]
                    )
                    return {
                        "visibleIds": visible_ids,
                        "selectedIds": [
                            conversation_id
                            for conversation_id in visible_ids
                            if conversation_id in self.selected
                        ],
                        "additionalSelected": (
                            "conversation-clear-b" in self.selected
                        ),
                        "controlSelected": (
                            "conversation-clear-c" in self.selected
                        ),
                        "clearEnabled": bool(self.selected),
                    }
                if "data-chat-storage-batch-result" in script:
                    status = args[0]
                    if status == "partial_failure":
                        self.selected = {"conversation-clear-e"}
                        return {
                            "succeeded": 1,
                            "failed": 1,
                            "releasedBytes": 2_100_000,
                            "retryVisible": True,
                            "selected": ["conversation-clear-e"],
                        }
                    succeeded = (2, 1, 1)[self.success_result_index]
                    self.success_result_index += 1
                    self.selected = set()
                    return {
                        "succeeded": succeeded,
                        "failed": 0,
                        "releasedBytes": 4_200_000,
                        "retryVisible": False,
                        "selected": [],
                    }
                if "return window.__PT_CHAT_STORAGE_BATCH_PROGRESS__" in script:
                    values = (
                        [{"completed": 0, "total": 2, "text": "0 / 2"}],
                        [{"completed": 1, "total": 2, "text": "1 / 2"}],
                        [{"completed": 1, "total": 2, "text": "1 / 2"}],
                    )[self.progress_index]
                    self.progress_index += 1
                    return values
                if "data-chat-storage-batch-confirm" in script:
                    selected_count = len(self.selected)
                    return {
                        "estimatedBytes": 4_200_000,
                        "selectedCount": selected_count,
                        "scope": "current-device",
                        "text": f"Clear {selected_count} on this device",
                    }
                if "checkbox.click()" in script and args:
                    self.selected.add(str(args[0]))
                    return True
                if "data-chat-storage-selected" in script:
                    if args:
                        return str(args[0]) in self.selected
                    return sorted(self.selected)
                if "data-chat-storage-batch-manage" in script:
                    self.search_query = ""
                    self.selected = set()
                return True

        session = Session()
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-batch-clear"
            )._run_storage_batch_clear_journey(
                session=session,
                journey_id="run",
            )

        self.assertEqual(len(result["conversationIds"]), 6)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["releasedBytes"], 4_200_000)
        self.assertEqual(result["estimatedReclaimableBytes"], 4_200_000)
        self.assertEqual(
            result["filteredSelection"]["filteredVisibleIds"],
            ["conversation-clear-a"],
        )
        self.assertEqual(
            result["filteredSelection"]["selectedAfterQueryClear"],
            ["conversation-clear-a"],
        )
        self.assertEqual(
            set(result["filteredSelection"]["selectedIds"]),
            {"conversation-clear-a", "conversation-clear-b"},
        )
        self.assertFalse(result["filteredSelection"]["controlSelected"])
        self.assertEqual(
            result["unselectedControl"]["afterRestart"]["messageId"],
            "message-clear-c",
        )
        self.assertTrue(result["unselectedPreserved"])
        self.assertEqual(result["partialFailure"]["failed"], 1)
        self.assertEqual(result["partialRetry"]["succeeded"], 1)
        self.assertEqual(result["scopeChange"]["completed"], 1)
        self.assertEqual(
            result["scopeChange"]["remainingConversationIds"],
            ["conversation-clear-g"],
        )
        self.assertTrue(result["restartStable"])
        self.assertTrue(result["messagingIdentityPreserved"])

    def test_storage_retention_journey_requires_prune_protection_and_restart(self) -> None:
        fixture = {
            "conversationId": "conversation-retention",
            "prunedMessageId": "message-pruned",
            "protectedMessageId": "message-protected",
            "recentMessageId": "message-recent",
        }

        class Session:
            def __init__(self) -> None:
                self.snapshots = [
                    {
                        "physicalTotalBytes": 4_000_000,
                        "messageBytes": 2_100_000,
                        "conversationIds": ["conversation-retention"],
                    },
                    {
                        "physicalTotalBytes": 1_500_000,
                        "retentionPreset": "4",
                        "retentionResultState": "succeeded",
                        "retentionReleasedBytes": 2_500_000,
                    },
                    {
                        "physicalTotalBytes": 1_500_000,
                        "retentionPreset": "4",
                    },
                ]

            def call_action(self, action: str, payload: object = None) -> object:
                if action == "storage.retention.seed":
                    return fixture
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action == "navigation.apply":
                    return {}
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "messaging.projection.read":
                    return {
                        "messages": {
                            "conversation-retention": [
                                {"messageId": "message-protected"},
                                {"messageId": "message-recent"},
                            ]
                        }
                    }
                raise AssertionError(action)

            def execute_script(self, script: str) -> object:
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                return True

        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-retention"
            )._run_storage_retention_journey(
                session=Session(),
                journey_id="run",
            )

        self.assertEqual(result["retentionPreset"], "4")
        self.assertEqual(result["releasedBytes"], 2_500_000)
        self.assertTrue(result["prunedMessageAbsent"])
        self.assertTrue(result["protectedMessagePreserved"])
        self.assertTrue(result["recentMessagePreserved"])
        self.assertTrue(result["restartStable"])

    def test_moments_journey_requires_receiver_and_rollback_readback(
        self,
    ) -> None:
        draft = {
            "kind": "moment",
            "targetId": "moment-compose-run",
            "payloadSha256": "b" * 64,
        }

        class SenderSession:
            def call_action(
                self,
                action: str,
                payload: object = None,
            ) -> object:
                if action == "moments.publish":
                    return {
                        "postId": "post-1",
                        "authorPtid": "ptid:alice",
                        "text": "mobile-moment-run",
                    }
                if action == "moments.comment":
                    return {"commentId": "reply-1"}
                if action == "reliability.draft.write":
                    return draft
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "reliability.draft.read":
                    return [draft]
                if action == "reliability.draft.action":
                    return {"drafts": []}
                raise AssertionError((action, payload))

        class ReceiverSession:
            def call_action(
                self,
                action: str,
                payload: object = None,
            ) -> object:
                if action == "moments.feed.read":
                    return {
                        "posts": [{
                            "postId": "post-1",
                            "authorPtid": "ptid:alice",
                            "text": "mobile-moment-run",
                        }]
                    }
                if action == "moments.react":
                    if isinstance(payload, dict) and payload.get("active"):
                        return [{
                            "kind": 1,
                            "count": "1",
                            "reactedByViewer": True,
                        }]
                    return []
                if action == "moments.comment":
                    return {"commentId": "comment-1"}
                if action == "moments.comments.read":
                    return [
                        {"commentId": "comment-1"},
                        {"commentId": "reply-1"},
                    ]
                raise AssertionError((action, payload))

        sender = MessagingActor(
            client_id="sim-ios",
            role="alice",
            station_url="https://primary.example",
            station_peer_id="station-primary",
            ptid="ptid:alice",
            account_ref="station-account:alice@p.t",
            federated_handle="@alice@primary",
            federation_id="federation-1",
        )
        receiver = MessagingActor(
            client_id="sim-ios-peer",
            role="bob",
            station_url="https://secondary.example",
            station_peer_id="station-secondary",
            ptid="ptid:bob",
            account_ref="station-account:bob@p.t",
            federated_handle="@bob@secondary",
            federation_id="federation-1",
        )

        result = SimulatorSocialGate("moments")._run_moments_journey(
            sender_session=SenderSession(),
            receiver_session=ReceiverSession(),
            sender=sender,
            receiver=receiver,
            journey_id="run",
        )

        self.assertEqual(result["post"]["postId"], "post-1")
        self.assertTrue(result["reactionCommitted"])
        self.assertTrue(result["reactionRolledBack"])
        self.assertTrue(result["draftRestartReadback"])


if __name__ == "__main__":
    unittest.main()
