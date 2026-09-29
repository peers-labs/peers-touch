from __future__ import annotations

import ast
import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling/acceptance/gates/agent/native_agent_runner.py"
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

    def test_core_lifecycle_does_not_require_provider_configuration(self) -> None:
        self.assertIn(
            'return journey not in {"cli-provider", "core-lifecycle"}',
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
                "create_dialog",
                "create_name",
                "create_submit",
                "create_title",
                "row",
                "menu",
                "menu_action",
                "profile",
                "profile_any",
                "profile_back",
                "profile_title",
                "profile_saved",
                "default",
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
            "duplicate_agent_native_ui",
            "set_default_agent_native_ui",
            "start_session_native_ui",
            "create_dialog_zero_persistence",
            "topic_load_failure_visible",
            "retry_topic_load_native_ui",
            "topic_load_recovered",
            "repeat_duplicate_unique_name_visible",
            "delete_duplicated_agent_native_ui",
            "deleted-selection.unavailable",
        ):
            with self.subTest(step=step):
                self.assertIn(step, lifecycle)
        self.assertIn("lifecycle_station_state(", lifecycle)
        self.assertIn("isinstance(conversations, list)", self.source)
        self.assertIn("isinstance(baseline_conversations, list)", lifecycle)
        self.assertIn(
            "self.wait_visible_element(selector, description)",
            self.source,
        )
        self.assertIn("input.focus();", self.source)
        self.assertIn("self.station_agent_absent(agent_id)", self.source)
        self.assertIn("delete confirmation closure", self.source)
        self.assertIn("native roster removal", self.source)
        self.assertNotIn(
            'duplicate_station["conversations"].get("conversations")',
            lifecycle,
        )
        self.assertIn("empty session start persisted a phantom", lifecycle)
        self.assertIn("finally:\n            proxy.restore()", lifecycle)
        self.assertNotIn("foundationDirectProbe", lifecycle)
        for command in (
            "agents_list",
            "agents_get",
            "agents_get_default",
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
        self.assertIn('return journey not in {"cli-provider", "core-lifecycle"}', self.source)
        self.assertIn("runner.run_cli_provider()", self.source)

    def test_cli_provider_journey_covers_primary_flow_and_restart(self) -> None:
        journey = self.source.split("    def run_cli_provider(self)", 1)[1]
        journey = journey.split("    def conversation_readback", 1)[0]
        for step in (
            "discover_create_and_open_empty_topic",
            "send_stream_and_persist",
            "restart_native_client",
            "restore_station_conversation_after_restart",
            "cleanup_cli_provider_fixture",
        ):
            with self.subTest(step=step):
                self.assertIn(step, journey)
        for method in (
            "prepareCliProviderPrimary",
            "executeCliProviderPrimary",
            "restoreCliProviderPrimary",
            "cleanupCliProviderPrimary",
        ):
            with self.subTest(method=method):
                self.assertIn(method, journey)
        self.assertIn("cleanupCliProviderPrimaryResidue", self.source)
        self.assertIn('"agent.cli-provider.stream.delta-observed"', journey)
        self.assertIn('"agent.cli-provider.restart.restored"', journey)
        self.assertIn('prepared_receiver.get("messageCount", -1)', journey)
        self.assertIn('prepared_station.get("messageCount", -1)', journey)
        self.assertNotIn('get("messageCount") or -1', journey)
        self.assertNotIn("PT_AGENT_PROVIDER_API_KEY", journey)

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
