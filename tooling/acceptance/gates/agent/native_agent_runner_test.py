from __future__ import annotations

import ast
import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling/acceptance/gates/agent/native_agent_runner.py"
CHAT_SUITE = ROOT / "tooling/acceptance/gates/agent/chat_native_suite.py"
HARNESS = ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
GATES = ROOT / "tooling/acceptance/gates.yaml"
MATRIX = (
    ROOT
    / "tooling/acceptance/matrices/agent-core-lifecycle-native.yaml"
)
CLI_MATRIX = (
    ROOT
    / "tooling/acceptance/matrices/agent-cli-provider-primary-native.yaml"
)


class AgentCoreLifecycleRunnerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = RUNNER.read_text(encoding="utf-8")
        cls.harness_source = HARNESS.read_text(encoding="utf-8")
        cls.tree = ast.parse(cls.source)
        cls.gate = json.loads(GATES.read_text(encoding="utf-8"))["gates"][
            "agent-core-lifecycle-native-e2e"
        ]
        cls.matrix_bytes = MATRIX.read_bytes()
        cls.matrix = json.loads(cls.matrix_bytes)

    def test_argparse_dispatches_core_lifecycle_to_the_registered_gate(self) -> None:
        self.assertIn(
            '"core-lifecycle": "agent-core-lifecycle-native-e2e"',
            self.source,
        )
        self.assertIn("runner.run_core_lifecycle()", self.source)
        self.assertIn('CORE_LIFECYCLE_PROFILE = "two"', self.source)
        self.assertIn(
            "self.approved_profile = approved_profile_for_journey(journey)",
            self.source,
        )
        self.assertEqual(
            self.gate["requiredRuntimeCells"],
            ["desktop-linux-native"],
        )

    def test_core_lifecycle_uses_the_explicit_native_runtime_cell(self) -> None:
        start = self.source.split("    def start(", 1)[1]
        start = start.split("    def seed_minimum_usable_actor_identity", 1)[0]
        self.assertIn(
            'cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()',
            start,
        )
        self.assertIn("if cell_id:", start)
        self.assertIn(
            "self.client_station_transport_url = canonical_origin",
            start,
        )
        self.assertIn(
            "self.chat_station_origin.activate(canonical_origin)",
            start,
        )
        self.assertIn(
            'if self.journey.startswith("chat-") and require_initial_route',
            start,
        )

    def test_core_lifecycle_binds_the_committed_direct_route_opaquely(
        self,
    ) -> None:
        resolver = self.source.split(
            "def active_direct_station_multiaddr(",
            1,
        )[1].split("MODEL_RUNTIME_CAPABILITY_IDS", 1)[0]
        self.assertIn('"active_station_peer_id"', resolver)
        self.assertIn('"active_route_id"', resolver)
        self.assertIn(
            'active_routes[0].get("route_type") == "direct"',
            resolver,
        )
        self.assertIn('"/p2p-circuit/" not in address', resolver)
        self.assertIn("len(direct_addresses) == 1", resolver)

        binding = self.source.split(
            "    def bind_direct_station_fault_route(self)",
            1,
        )[1].split("    def release_direct_station_fault_route", 1)[0]
        self.assertIn(
            'self.tauri_driver.invoke_app_result("station_list")',
            binding,
        )
        self.assertIn("TcpFaultProxy.from_multiaddr(direct_multiaddr)", binding)
        self.assertIn(
            "self.runtime_binding.create_transport_override(",
            binding,
        )
        self.assertIn(
            "self.runtime_binding.apply_verified_direct_route_override(",
            binding,
        )
        self.assertIn("self.direct_fault_proxy = proxy", binding)
        self.assertIn(
            "self.direct_station_transport_override = handle",
            binding,
        )
        self.assertNotIn("transport_override_endpoint(", binding)

    def test_topic_fault_waits_for_the_existing_load_owner_to_finish(self) -> None:
        fault = self.harness_source.split(
            "async prepareAgentTopicLoadFailure",
            1,
        )[1].split(
            "async getAgentTopicLoadState",
            1,
        )[0]
        idle_wait = fault.index(
            "!useAgentTopicStore.getState().loadingAgentIds[agentId]",
        )
        load = fault.index("await topicStore.loadTopicsForAgent(", idle_wait)
        self.assertLess(idle_wait, load)

    def test_core_lifecycle_does_not_require_provider_configuration(self) -> None:
        self.assertIn(
            '"minimum-usable-chat",',
            self.source,
        )
        self.assertIn(
            "if self.provider_configuration_required:",
            self.source,
        )
        lifecycle = self.source.split("    def run_core_lifecycle(self)", 1)[1]
        lifecycle = lifecycle.split("    def run_attachment(self)", 1)[0]
        self.assertNotIn('"configure_created_agent"', lifecycle)
        self.assertIn('"getCoreLifecycleAgentState"', lifecycle)
        self.assertNotIn('"getFoundationAgentState"', lifecycle)

    def test_retired_duplicate_and_default_entries_are_absent(self) -> None:
        for relative in (
            "apps/desktop/src/pages/SettingsPage.tsx",
            "apps/desktop/src/services/agent-service.ts",
            "apps/desktop/src/services/desktop_api.ts",
            "apps/desktop/src/store/agent.ts",
            "apps/desktop/src/store/settings.ts",
        ):
            source = (ROOT / relative).read_text(encoding="utf-8")
            with self.subTest(path=relative):
                self.assertNotIn("duplicateAgent", source)
                self.assertNotIn("setDefaultAgent", source)
                self.assertNotIn("agents_duplicate", source)
                self.assertNotIn("agents_set_default", source)

    def test_lifecycle_selectors_are_isolated_as_an_integration_contract(
        self,
    ) -> None:
        assignments = {
            node.targets[0].id: ast.literal_eval(node.value)
            for node in self.tree.body
            if isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "CORE_LIFECYCLE_SELECTORS"
        }
        selectors = assignments["CORE_LIFECYCLE_SELECTORS"]
        self.assertEqual(
            set(selectors),
            {
                "create",
                "row",
                "menu",
                "menu_action",
                "profile",
                "profile_any",
                "profile_back",
                "profile_title",
                "profile_saved",
                "session_start",
                "topic_error",
                "topic_retry",
                "composer",
                "confirm_delete",
            },
        )
        self.assertTrue(
            all(value.startswith("[data-pt-") for value in selectors.values())
        )
        self.assertEqual(
            selectors["confirm_delete"],
            '[data-pt-agent-delete-confirm="{agent_id}"]',
        )

    def test_agent_chat_primary_navigation_uses_action_icon_role(self) -> None:
        helper = self.source.split(
            "    def click_primary_navigation(",
            1,
        )[1].split("    def set_input_value(", 1)[0]
        self.assertIn(
            """f'[data-pt-primary-nav="{page_id}"] [role="button"]'""",
            helper,
        )
        scenario_sources = "\n".join(
            (
                (
                    ROOT
                    / "tooling/acceptance/gates/agent/chat_model_scenarios.py"
                ).read_text(encoding="utf-8"),
                (
                    ROOT
                    / "tooling/acceptance/gates/agent/chat_native_suite.py"
                ).read_text(encoding="utf-8"),
            )
        )
        self.assertNotIn('[data-pt-primary-nav="settings"] button', scenario_sources)
        self.assertNotIn('[data-pt-primary-nav="agent"] button', scenario_sources)
        self.assertIn(
            'click_primary_navigation("settings", "global Settings")',
            scenario_sources,
        )

    def test_agent_selection_filters_long_rails_through_product_search(self) -> None:
        helper = self.source.split(
            "    def filter_agent_rail(",
            1,
        )[1].split("    def select_agent_chat(", 1)[0]
        selection = self.source.split(
            "    def select_agent_chat(",
            1,
        )[1].split("    def lifecycle_station_state(", 1)[0]
        actions = self.source.split(
            "    def click_agent_action(",
            1,
        )[1].split("    def filter_agent_rail(", 1)[0]

        self.assertIn("agent.sidebar.searchAgents", helper)
        self.assertIn('data-pt-agent-rail="collapsed"', helper)
        self.assertIn('data-pt-panel-toggle-dock="left"', helper)
        self.assertIn('data-pt-agent-rail="expanded"', helper)
        self.assertIn("def ensure_expanded()", helper)
        self.assertIn(
            "self._visible_web_element(",
            helper,
        )
        self.assertIn(
            'wait_until(ensure_expanded, "expanded Agent rail")',
            helper,
        )
        self.assertNotIn('"expand Agent rail"', helper)
        self.assertIn("self.station_agent(agent_id)", helper)
        self.assertIn("self.set_input_value(", helper)
        self.assertIn("self.filter_agent_rail(agent_id)", selection)
        self.assertIn("self.filter_agent_rail(agent_id)", actions)
        self.assertNotIn("scrollIntoView", helper)

    def test_lifecycle_journey_covers_required_actions_and_negative_states(
        self,
    ) -> None:
        lifecycle = self.source.split("    def run_core_lifecycle(self)", 1)[1]
        lifecycle = lifecycle.split("    def run_attachment(self)", 1)[0]
        for step in (
            "create_agent_native_ui",
            "created_agent_listed",
            "select_baseline_agent",
            "edit_agent_name_native_ui",
            "create_second_agent_native_ui",
            "legacy_duplicate_default_cut_absent",
            "start_session_native_ui",
            "topic_load_fault_route_bound",
            "topic_load_fault_acknowledged",
            "topic_load_failure_visible",
            "retry_topic_load_native_ui",
            "topic_load_recovered",
            "topic_load_fault_route_released",
            "create_third_agent_native_ui",
            "delete_second_created_agent_native_ui",
            "deleted-selection.unavailable",
        ):
            with self.subTest(step=step):
                self.assertIn(step, lifecycle)
        self.assertIn("lifecycle_station_state(", lifecycle)
        self.assertIn("isinstance(conversations, list)", self.source)
        self.assertIn("isinstance(baseline_conversations, list)", lifecycle)
        click_support = self.source.split(
            "    def _visible_web_element(",
            1,
        )[1].split("    def set_input_value(", 1)[0]
        click_visible = click_support.split(
            "    def click_visible(",
            1,
        )[1].split("    def click_primary_navigation(", 1)[0]
        self.assertIn("def click_once()", click_visible)
        self.assertIn("return wait_until(click_once, description)", click_visible)
        self.assertNotIn("self.wait_visible_element(", click_visible)
        self.assertIn(
            'self.driver.find_elements("css selector", selector)',
            click_support,
        )
        self.assertIn("isinstance(state, dict)", click_support)
        self.assertIn('state.get("visible") is True', click_support)
        self.assertIn(
            'and (text is None or state.get("text") == text)',
            click_support,
        )
        self.assertIn("element.click()", click_visible)
        self.assertIn("if pointer_sequence:", click_visible)
        self.assertIn("new PointerEvent('pointerdown'", click_visible)
        self.assertIn("new MouseEvent('mousedown'", click_visible)
        self.assertIn("new MouseEvent('click'", click_visible)
        self.assertNotIn("element.click();", click_visible)
        self.assertIn("input.focus();", self.source)
        self.assertIn("self.station_agent_absent(agent_id)", self.source)
        self.assertIn("delete confirmation closure", self.source)
        self.assertIn("native roster removal", self.source)
        self.assertNotIn('click_agent_action(created_id, "clone")', lifecycle)
        self.assertNotIn('"set_default_agent_native_ui"', lifecycle)
        self.assertIn("empty session start persisted a phantom", lifecycle)
        self.assertIn("finally:\n            proxy.restore()", lifecycle)
        self.assertLess(
            lifecycle.index('"topic_load_fault_route_bound"'),
            lifecycle.index("proxy.cut()"),
        )
        self.assertLess(
            lifecycle.index("proxy.cut()"),
            lifecycle.index('"topic_load_fault_acknowledged"'),
        )
        self.assertLess(
            lifecycle.index('"topic_load_fault_acknowledged"'),
            lifecycle.index('"topic_load_failure_visible"'),
        )
        self.assertIn(
            '"Station transport rejection after topic fault",\n'
            "                    timeout=30,",
            lifecycle,
        )
        self.assertGreater(
            lifecycle.rindex(
                "self.runtime_binding.apply_verified_direct_route_override("
            ),
            lifecycle.index("proxy.restore()"),
        )
        self.assertNotIn(
            "self.runtime_binding.apply_transport_override(",
            lifecycle,
        )
        self.assertNotIn("foundationDirectProbe", lifecycle)
        for command in (
            "agents_list",
            "agents_get",
            "agents_get_selected",
        ):
            with self.subTest(command=command):
                self.assertIn(f'"{command}"', self.source)

    def test_gate_argv_and_reviewed_matrix_are_identical(self) -> None:
        self.assertEqual(self.gate["argv"], self.matrix["command_argv"])
        self.assertEqual(self.gate["environment"], self.matrix["environment"])
        self.assertEqual(self.matrix["runtime"]["profile"], "two")
        self.assertEqual(
            self.gate["runtime_matrix"],
            {
                "id": self.matrix["id"],
                "version": self.matrix["version"],
                "sha256": hashlib.sha256(self.matrix_bytes).hexdigest(),
                "expected_tuple_count": self.matrix["expected_tuple_count"],
                "expected_assertion_count": self.matrix[
                    "expected_assertion_count"
                ],
            },
        )

    def test_gate_requires_receiver_station_and_cleanup_evidence(self) -> None:
        self.assertEqual(
            self.gate["required_artifact_roles"],
            ["receiver-dom", "station-readback", "cleanup"],
        )
        self.assertIn('"evidence/receiver-dom.json"', self.source)
        self.assertIn('"evidence/station-readback.json"', self.source)
        self.assertIn('"evidence/cleanup.json"', self.source)

    def test_chat_suite_enters_agent_through_primary_navigation(self) -> None:
        navigation = self.source.split(
            "    def navigate_and_configure(self)",
            1,
        )[1].split(
            "    def runtime_snapshot(",
            1,
        )[0]
        self.assertIn(
            'self.click_primary_navigation("agent", "Agent workspace")',
            navigation,
        )
        self.assertIn(
            '"[data-pt-agent-composer]"',
            navigation,
        )
        self.assertIn(
            '"waitForIdleSessionRuntimes"',
            navigation,
        )
        self.assertIn(
            'idle_runtime.get("state") == "ready"',
            navigation,
        )
        self.assertNotIn('self.harness("navigateToAgent"', navigation)

    def test_cleanup_failure_cannot_hide_the_first_gate_failure(self) -> None:
        lifecycle_cleanup = self.source.split(
            "    def cleanup_lifecycle_fixtures(self)",
            1,
        )[1].split(
            "    def cleanup_minimum_usable_resources(self)",
            1,
        )[0]
        self.assertIn(
            'failures.append(f"Agent profile inspection: {error}")',
            lifecycle_cleanup,
        )

        suite = CHAT_SUITE.read_text(encoding="utf-8")
        cleanup = suite.split("        finally:", 1)[1].split(
            "        lifecycle =",
            1,
        )[0]
        self.assertIn("except Exception as cleanup_error:", cleanup)
        self.assertIn("if not failure:", cleanup)
        self.assertIn('failure = f"cleanup failed: {cleanup_failure}"', cleanup)
        self.assertIn('"status": "failed"', cleanup)


class AgentMinimumUsableChatRunnerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = RUNNER.read_text(encoding="utf-8")
        cls.harness_source = HARNESS.read_text(encoding="utf-8")
        cls.gate = json.loads(GATES.read_text(encoding="utf-8"))["gates"][
            "agent-minimum-usable-chat-native-e2e"
        ]

    def test_dedicated_native_journey_is_registered_without_matrix(self) -> None:
        self.assertIn(
            '"minimum-usable-chat": "agent-minimum-usable-chat-native-e2e"',
            self.source,
        )
        self.assertIn("runner.run_minimum_usable_chat()", self.source)
        self.assertIn("runner.seed_minimum_usable_actor_identity", self.source)
        self.assertEqual(
            self.gate["argv"],
            [
                "python3",
                "tooling/acceptance/gates/agent/native_agent_runner.py",
                "--journey",
                "minimum-usable-chat",
            ],
        )
        self.assertEqual(self.gate["environment"], "home-station")
        self.assertNotIn("runtime_matrix", self.gate)
        self.assertEqual(
            self.gate["required_artifact_roles"],
            ["receiver-dom", "station-readback", "cleanup"],
        )

    def test_journey_uses_one_real_direct_model_mcp_turn_and_restart(self) -> None:
        journey = self.source.split(
            "    def run_minimum_usable_chat(self)",
            1,
        )[1].split("    def conversation_readback", 1)[0]
        for step in (
            "start_direct_model_provider_fixture",
            "bridge_direct_model_provider_to_station",
            "native_capability_session_ready",
            "configure_select_bind_send_and_complete",
            "restart_native_client",
            "recover_agent_conversation_and_capability",
            "verify_mcp_process_cleanup",
        ):
            with self.subTest(step=step):
                self.assertIn(step, journey)
        self.assertIn('"runMcpLifecycleDevelopment"', journey)
        self.assertIn('"expectedAssistantResponse"', journey)
        self.assertIn("OpenAIProviderFixture(", journey)
        self.assertIn("RemoteProviderBridge(", journey)
        self.assertIn("expected_prepared_assertions", journey)
        self.assertIn("expected_recovered_assertions", journey)
        self.assertIn('prepared_tool_call.get("visible") is True', journey)
        self.assertIn(
            'restored_conversation.get("visible") is True',
            journey,
        )
        self.assertNotIn("agent_v2_gate.py", journey)

    def test_harness_requires_final_response_and_restart_readback(self) -> None:
        journey = self.harness_source.split(
            "async function prepareMcpLifecycleDevelopmentJourney(",
            1,
        )[1].split(
            "async function runMcpLifecycleDevelopmentJourney(",
            1,
        )[0]
        for assertion in (
            "directModelAgentSelected",
            "governedMcpInvocationSucceeded",
            "finalAssistantVisibleAndPersisted",
            "agentAndDirectModelSurvivedRestart",
            "conversationAndFinalReplySurvivedRestart",
        ):
            with self.subTest(assertion=assertion):
                self.assertIn(assertion, journey)
        self.assertIn("state.assistantMessageId", journey)
        self.assertIn("state.assistantContentHash", journey)
        self.assertIn("state.expectedAssistantResponse", journey)
        self.assertIn("'acceptance-minimum-usable-restart'", journey)
        self.assertIn("const toolCallVisible = () => Boolean(", journey)


class AgentCliProviderPrimaryRunnerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = RUNNER.read_text(encoding="utf-8")
        cls.harness_source = HARNESS.read_text(encoding="utf-8")
        cls.gate = json.loads(GATES.read_text(encoding="utf-8"))["gates"][
            "agent-cli-provider-primary-native-e2e"
        ]
        cls.matrix_bytes = CLI_MATRIX.read_bytes()
        cls.matrix = json.loads(cls.matrix_bytes)

    def test_cli_provider_dispatches_without_http_provider_configuration(
        self,
    ) -> None:
        self.assertIn(
            '"cli-provider": "agent-cli-provider-primary-native-e2e"',
            self.source,
        )
        self.assertIn('CLI_PROVIDER_PROFILE = "two"', self.source)
        self.assertIn('"minimum-usable-chat",', self.source)
        self.assertIn("runner.run_cli_provider()", self.source)

    def test_cli_provider_journey_covers_primary_flow_and_restart(self) -> None:
        journey = self.source.split("    def run_cli_provider(self)", 1)[1]
        journey = journey.split("    def conversation_readback", 1)[0]
        for step in (
            "discover_create_and_open_empty_topic",
            "send_stream_and_persist",
            "restart_native_client",
            "restore_station_conversation_after_restart",
            "typed_failure_without_fabricated_completion",
            "cleanup_cli_provider_fixture",
        ):
            with self.subTest(step=step):
                self.assertIn(step, journey)
        for method in (
            "prepareCliProviderPrimary",
            "executeCliProviderPrimary",
            "restoreCliProviderPrimary",
            "executeCliProviderFailure",
            "cleanupCliProviderPrimary",
        ):
            with self.subTest(method=method):
                self.assertIn(method, journey)
        self.assertIn("cleanupCliProviderPrimaryResidue", self.source)
        self.assertIn('"agent.cli-provider.stream.delta-observed"', journey)
        self.assertIn('"agent.cli-provider.restart.restored"', journey)
        self.assertIn('"agent.cli-provider.failure.typed-visible"', journey)
        self.assertIn(
            '"agent.cli-provider.failure.no-fabricated-completion"',
            journey,
        )
        self.assertIn('prepared_receiver.get("messageCount", -1)', journey)
        self.assertIn('prepared_station.get("messageCount", -1)', journey)
        self.assertNotIn('get("messageCount") or -1', journey)
        self.assertNotIn("PT_AGENT_PROVIDER_API_KEY", journey)
        self.assertIn("CLI_FAILURE_PROVIDER_ID = 'codex-cli'", self.harness_source)
        self.assertIn("cli_binary_missing", self.harness_source)

    def test_state_preserving_restart_does_not_require_the_initial_route(
        self,
    ) -> None:
        start = self.source.split("    def start(", 1)[1]
        start = start.split("    def restart_native_runtime", 1)[0]
        restart = self.source.split("    def restart_native_runtime", 1)[1]
        restart = restart.split("    def login", 1)[0]
        self.assertIn("require_initial_route: bool = True", start)
        self.assertIn("if require_initial_route:", start)
        self.assertIn("self.tauri_driver.wait_for_ready()", start)
        self.assertIn("self.tauri_driver.wait_for_acceptance_harness()", start)
        self.assertIn("self.start(require_initial_route=False)", restart)
        self.assertNotIn("self.start()", restart)

    def test_cli_provider_fixture_uses_automatic_thinking_negotiation(self) -> None:
        preparation = self.harness_source.split(
            "async function prepareCliProviderPrimaryJourney",
            1,
        )[1].split(
            "async function executeCliProviderPrimaryTurn",
            1,
        )[0]
        self.assertIn("thinkingMode: 'auto'", preparation)
        self.assertNotIn("thinkingMode: 'disabled'", preparation)

    def test_cli_provider_failure_fixture_cleans_all_stale_residue_first(
        self,
    ) -> None:
        failure = self.harness_source.split(
            "async function executeCliProviderFailureJourney",
            1,
        )[1].split(
            "async function restoreCliProviderPrimaryJourney",
            1,
        )[0]
        self.assertLess(
            failure.index("cleanupCliProviderPrimaryResidue("),
            failure.index("api.getProvider(CLI_FAILURE_PROVIDER_ID)"),
        )
        self.assertIn("sampleId,\n    priorSelection,", failure)
        self.assertIn(
            "agent.acceptance.cliFailureFixtureCleanupFailed",
            failure,
        )

        cleanup = self.harness_source.split(
            "async function cleanupCliProviderPrimaryResidue",
            1,
        )[1].split(
            "export function installAcceptanceHarness",
            1,
        )[0]
        self.assertIn("const prefix = 'cli-primary-'", cleanup)
        self.assertIn("candidate.name !== preservedAgentName", cleanup)
        self.assertIn(
            "model.id.startsWith('acceptance-missing-')",
            cleanup,
        )
        self.assertIn(
            "if (Number(provider.version ?? 0) > 0)",
            cleanup,
        )
        self.assertNotIn("ownsFailureModel", cleanup)

    def test_cli_provider_gate_and_reviewed_matrix_are_identical(self) -> None:
        self.assertEqual(self.gate["argv"], self.matrix["command_argv"])
        self.assertEqual(self.gate["environment"], self.matrix["environment"])
        self.assertEqual(self.matrix["runtime"]["profile"], "two")
        self.assertEqual(
            self.gate["runtime_matrix"],
            {
                "id": self.matrix["id"],
                "version": self.matrix["version"],
                "sha256": hashlib.sha256(self.matrix_bytes).hexdigest(),
                "expected_tuple_count": self.matrix["expected_tuple_count"],
                "expected_assertion_count": self.matrix[
                    "expected_assertion_count"
                ],
            },
        )
        self.assertEqual(
            self.gate["required_artifact_roles"],
            ["receiver-dom", "station-readback", "cleanup"],
        )


if __name__ == "__main__":
    unittest.main()
