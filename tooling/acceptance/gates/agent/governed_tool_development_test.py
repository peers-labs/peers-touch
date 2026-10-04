from __future__ import annotations

import copy
import json
import subprocess
import unittest
import urllib.error
import urllib.request
from unittest.mock import Mock

from tooling.acceptance.gates.agent.governed_tool_development import (
    FIXTURE_CLIPBOARD_TEXT,
    FIXTURE_LOOP_MARKER,
    FIXTURE_TOOL_NAME,
    GovernedToolDevelopmentError,
    OpenAIProviderFixture,
    RemoteProviderBridge,
    ROOT,
    evaluate_governed_tool,
)


def valid_journey() -> dict[str, object]:
    return {
        "assertions": {
            "nativeApprovalSubmittedOnce": True,
            "oneExecutionAndSideEffect": True,
            "durableLineageComplete": True,
            "stationReplayEqual": True,
            "nativeReceiverAuthoritative": True,
            "cleanupComplete": True,
        },
        "receiver-dom": {
            "visible": True,
            "status": "success",
            "governanceVisible": True,
        },
        "station-readback": {
            "entityKind": "agent-tool-call-lineage",
            "sourceHash": "a" * 64,
            "replayHash": "a" * 64,
        },
        "cleanup": {"status": "clean"},
    }


def valid_provider_requests() -> list[dict[str, object]]:
    return [
        {
            "path": "/v1/chat/completions",
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": False,
            "hasExpectedToolResult": False,
            "toolNames": [FIXTURE_TOOL_NAME],
        },
        {
            "path": "/v1/chat/completions",
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": True,
            "hasExpectedToolResult": True,
            "toolNames": [FIXTURE_TOOL_NAME],
        },
    ]


class GovernedToolDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_native_journey(self) -> None:
        assertions = evaluate_governed_tool(
            valid_journey(),
            valid_provider_requests(),
        )

        self.assertTrue(all(assertions.values()))

    def test_rejects_missing_provider_continuation(self) -> None:
        with self.assertRaisesRegex(
            GovernedToolDevelopmentError,
            "deterministicProviderSequence",
        ):
            evaluate_governed_tool(
                valid_journey(),
                valid_provider_requests()[:1],
            )

    def test_rejects_unproven_native_receiver(self) -> None:
        journey = copy.deepcopy(valid_journey())
        journey["receiver-dom"]["status"] = "unknown_side_effect"

        with self.assertRaisesRegex(
            GovernedToolDevelopmentError,
            "nativeReceiverObserved",
        ):
            evaluate_governed_tool(journey, valid_provider_requests())

    def test_rejects_ambient_clipboard_result(self) -> None:
        requests = valid_provider_requests()
        requests[1]["hasExpectedToolResult"] = False

        with self.assertRaisesRegex(
            GovernedToolDevelopmentError,
            "deterministicProviderSequence",
        ):
            evaluate_governed_tool(valid_journey(), requests)

    def test_fixture_emits_one_tool_call_then_terminal_continuation(self) -> None:
        fixture = OpenAIProviderFixture()
        fixture.start()
        try:
            initial = self._request(
                fixture.port,
                fixture.api_key,
                [{"role": "user", "content": "run the governed tool"}],
            )
            continuation = self._request(
                fixture.port,
                fixture.api_key,
                [
                    {"role": "user", "content": "run the governed tool"},
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "provider-call-1",
                            "type": "function",
                            "function": {
                                "name": FIXTURE_TOOL_NAME,
                                "arguments": "{}",
                            },
                        }],
                    },
                    {
                        "role": "tool",
                        "tool_call_id": "provider-call-1",
                        "content": (
                            '{"output":{"text":"'
                            f'{FIXTURE_CLIPBOARD_TEXT}'
                            '"}}'
                        ),
                    },
                ],
            )
        finally:
            fixture.stop()

        self.assertIn('"finish_reason":"tool_calls"', initial)
        self.assertIn(f'"name":"{FIXTURE_TOOL_NAME}"', initial)
        self.assertIn("Governed tool execution completed.", continuation)
        self.assertIn('"finish_reason":"stop"', continuation)
        requests = fixture.snapshot()
        self.assertEqual(len(requests), 2)
        self.assertFalse(requests[0]["hasToolResult"])
        self.assertTrue(requests[1]["hasToolResult"])
        self.assertTrue(requests[1]["hasExpectedToolResult"])

    def test_fixture_rejects_a_different_run_credential(self) -> None:
        fixture = OpenAIProviderFixture()
        fixture.start()
        try:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self._request(
                    fixture.port,
                    f"{fixture.api_key}-wrong",
                    [{"role": "user", "content": "run the governed tool"}],
                )
        finally:
            fixture.stop()

        self.assertEqual(raised.exception.code, 422)
        self.assertFalse(fixture.snapshot()[0]["authorizationPresent"])

    def test_fixture_repeats_tool_call_for_explicit_loop_budget_prompt(
        self,
    ) -> None:
        fixture = OpenAIProviderFixture()
        fixture.start()
        try:
            continuation = self._request(
                fixture.port,
                fixture.api_key,
                [
                    {
                        "role": "user",
                        "content": f"[{FIXTURE_LOOP_MARKER}] repeat",
                    },
                    {
                        "role": "tool",
                        "tool_call_id": "provider-call-1",
                        "content": (
                            '{"output":{"text":"'
                            f'{FIXTURE_CLIPBOARD_TEXT}'
                            '"}}'
                        ),
                    },
                ],
            )
        finally:
            fixture.stop()

        self.assertIn('"finish_reason":"tool_calls"', continuation)
        self.assertIn(f'"name":"{FIXTURE_TOOL_NAME}"', continuation)
        self.assertNotIn("Governed tool execution completed.", continuation)
        self.assertTrue(fixture.snapshot()[0]["repeatUntilStopped"])

    def test_fixture_cleanup_is_safe_before_start(self) -> None:
        fixture = OpenAIProviderFixture()

        fixture.stop()

        self.assertFalse(fixture.started)

    def test_remote_bridge_resolves_station_container_gateway(self) -> None:
        bridge = object.__new__(RemoteProviderBridge)
        bridge.compose_project = "pt-station-two"
        bridge.compose_service = "station"
        bridge.transport = Mock()
        bridge.transport.run_argv.side_effect = [
            subprocess.CompletedProcess(
                args=["docker", "ps"],
                returncode=0,
                stdout="container-id\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=["docker", "inspect"],
                returncode=0,
                stdout="172.21.0.1\n",
                stderr="",
            ),
        ]

        gateway = bridge._resolve_station_gateway()

        self.assertEqual(gateway, "172.21.0.1")
        self.assertEqual(
            bridge.transport.run_argv.call_args_list[0].args[0],
            (
                "docker",
                "ps",
                "-q",
                "--filter",
                "label=com.docker.compose.project=pt-station-two",
                "--filter",
                "label=com.docker.compose.service=station",
            ),
        )

    def test_remote_bridge_parses_compose_project_name(self) -> None:
        self.assertEqual(
            RemoteProviderBridge._compose_project_name(
                "docker compose -p pt-station-two up -d station"
            ),
            "pt-station-two",
        )
        self.assertEqual(
            RemoteProviderBridge._compose_project_name(
                "docker compose --project-name=pt-station-two up"
            ),
            "pt-station-two",
        )

    def test_runner_uses_profile_two_reverse_tunnel_and_dedicated_harness(
        self,
    ) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "governed_tool_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn("resolve_machine_profile()", source)
        self.assertIn("AGENT_V2_GOVERNED_TOOL_GATE", source)
        self.assertIn("start_reverse_forward(", source)
        self.assertIn('"runGovernedToolDevelopment"', source)
        self.assertIn("seed_native_actor_identity(", source)
        self.assertIn("persist_native_actor_identity(", source)
        self.assertIn("OPERATION_SCENARIO_ACTOR_ACCOUNT", source)
        self.assertIn("OPERATION_SCENARIO_IDENTITY_FIXTURE", source)
        self.assertIn('"providerApiKey": provider_fixture.api_key', source)
        self.assertIn("create_native_desktop_adapter()", source)
        self.assertIn("native_adapter.write_clipboard(original_clipboard)", source)
        self.assertNotIn("agent_v2_gate.py", source)
        self.assertNotIn("J02_ACTOR_ACCOUNT", source)
        self.assertNotIn("J02_IDENTITY_FIXTURE", source)
        self.assertNotIn("reset_fixture", source)
        enrollment = source.find("confirm_native_actor_identity_enrollment(")
        persistence = source.find(
            "persist_native_actor_identity(",
            enrollment,
        )
        journey = source.find('"runGovernedToolDevelopment"', persistence)
        self.assertGreaterEqual(enrollment, 0)
        self.assertGreater(persistence, enrollment)
        self.assertGreater(journey, persistence)
        harness_source = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("api_key: apiKey", harness_source)
        self.assertRegex(
            harness_source,
            r"if \(candidateMode && cell === 'AS-05A'\) \{\s+"
            r"const aggregate = await runFoundationF04Scenario",
        )
        self.assertIn(
            "function foundationLoopBudgetReached(",
            harness_source,
        )
        self.assertIn(
            "agent.acceptance.foundationToolLoopUnexpectedTerminal:",
            harness_source,
        )
        self.assertIn(
            "foundationLoopBudgetReached,\n"
            "      'Foundation ToolCall loop budget'",
            harness_source,
        )
        self.assertRegex(
            harness_source,
            r"approvalBranchesComplete:\s+!candidateMode\s+"
            r"\|\| cell !== 'AS-05A'",
        )
        self.assertIn("await api.closeSecondaryCapabilitySession()", harness_source)
        self.assertIn("await api.startAgentClientExecutorSupervisor()", harness_source)
        self.assertRegex(
            harness_source,
            r"if \(executionAttemptCount === 0\) return 0;",
        )
        self.assertRegex(
            harness_source,
            r"executionAttemptCount:\s+\(\s+"
            r"\['CR-04I', 'REPLAY-O07I'\]\.includes\(cell\)\s+"
            r"&& platform === 'desktop_app'\s+"
            r"\) \? 2 : 1",
        )
        self.assertRegex(
            harness_source,
            r"stationFact\.executionAttemptCount\s+"
            r"=== expectedOutcome\.executionAttemptCount",
        )
        self.assertIn(
            "primary=${primaryMessage}; cleanup=${cleanupMessage}",
            harness_source,
        )
        journey_start = harness_source.find(
            "async function runGovernedToolDevelopmentJourney",
        )
        journey_end = harness_source.find(
            "interface CapabilityBindingCandidateFixture",
            journey_start,
        )
        self.assertGreaterEqual(journey_start, 0)
        self.assertGreater(journey_end, journey_start)
        governed_journey = harness_source[journey_start:journey_end]
        self.assertRegex(
            governed_journey,
            r"await useAgentStore\.getState\(\)\.loadAgents\(\);\s+"
            r"const agentStore = useAgentStore\.getState\(\);\s+"
            r"const priorSelection = agentStore\.selectedAgent;",
        )
        self.assertRegex(
            governed_journey,
            r"eventBus\.publish\(EVENT\.NAVIGATION_REQUESTED, "
            r"\{ resource: 'sessions' \}\);\s+"
            r"if \(priorSelection\) \{\s+"
            r"await api\.setSelectedAgent\(priorSelection\);\s+"
            r"useAgentStore\.getState\(\)\.setSelectedAgent\(priorSelection\);",
        )
        self.assertIn(
            "await refreshGovernedToolCapabilitySession(platform)",
            governed_journey,
        )
        self.assertIn(
            "deleteFoundationDisposableRuntimeFixture(runtimeFixture)",
            governed_journey,
        )
        self.assertIn(
            "fixture.providerId.startsWith(fixture.providerPrefix)",
            harness_source,
        )
        self.assertIn(
            "Number(replay.status) === AgentTurnStatus.COMPLETED",
            governed_journey,
        )
        self.assertIn(
            "isAgentLifecycleTerminalMutationError(typedError)",
            governed_journey,
        )
        self.assertIn(
            "cancellationStatus = typedError.details.terminal_status",
            governed_journey,
        )
        self.assertIn(
            "[AgentTurnStatus.COMPLETED]: 'completed'",
            harness_source,
        )
        self.assertIn(
            "const canonicalName = String(value ?? '').trim().toLowerCase();",
            harness_source,
        )
        self.assertRegex(
            harness_source,
            r"\]\.includes\(canonicalName\)\s+\? canonicalName\s+: 'unknown'",
        )
        self.assertNotIn("await api.deleteModel(", governed_journey)
        self.assertNotIn(
            "foundationApprovalExpiryCleanupDebugScope",
            harness_source,
        )
        self.assertNotIn(
            "reportFoundationApprovalExpiryCleanupDebug",
            harness_source,
        )
        self.assertIn(
            "if (!isFoundationResourceNotFound(error)) throw error;",
            harness_source,
        )
        self.assertIn(
            "if (isFoundationResourceNotFound(error)) return null;",
            harness_source,
        )
        self.assertIn(
            "modelDeleted: restoredProvider === null",
            harness_source,
        )
        self.assertIn("providerApiKey: string", harness_source)
        self.assertNotIn(
            "api_key: crypto.randomUUID()",
            harness_source,
        )

    def test_desktop_tool_decision_uses_turn_execution_off_main_thread(
        self,
    ) -> None:
        application_source = (
            ROOT
            / "apps/desktop/src-tauri/src/application/agent_turn/mod.rs"
        ).read_text(encoding="utf-8")
        command_source = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "station_client::request_proto_with_policy",
            application_source,
        )
        self.assertRegex(
            application_source,
            r"fn tool_decision_transport_policy\(\)"
            r" -> station_client::StationTransportPolicy \{\s+"
            r"station_client::StationTransportPolicy::TurnExecution",
        )
        command_start = command_source.index(
            "pub async fn agent_submit_tool_decision",
        )
        command_end = command_source.index(
            "#[tauri::command]",
            command_start,
        )
        decision_command = command_source[command_start:command_end]
        self.assertIn("run_blocking_agent_command(", decision_command)
        self.assertIn(
            '"agent.toolDecisionTaskFailed"',
            decision_command,
        )

    @staticmethod
    def _request(
        port: int,
        api_key: str,
        messages: list[dict[str, object]],
    ) -> str:
        payload = {
            "model": "mca-j03-model",
            "messages": messages,
            "stream": True,
            "tools": [{
                "type": "function",
                "function": {
                    "name": FIXTURE_TOOL_NAME,
                    "description": "Read the clipboard",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                    },
                },
            }],
        }
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.read().decode("utf-8")


if __name__ == "__main__":
    unittest.main(verbosity=2)
