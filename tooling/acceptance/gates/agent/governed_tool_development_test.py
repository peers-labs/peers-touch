from __future__ import annotations

import copy
import json
import unittest
import urllib.request

from tooling.acceptance.gates.agent.governed_tool_development import (
    FIXTURE_API_KEY,
    FIXTURE_TOOL_NAME,
    GovernedToolDevelopmentError,
    OpenAIProviderFixture,
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
            "toolNames": [FIXTURE_TOOL_NAME],
        },
        {
            "path": "/v1/chat/completions",
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": True,
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

    def test_fixture_emits_one_tool_call_then_terminal_continuation(self) -> None:
        fixture = OpenAIProviderFixture()
        fixture.start()
        try:
            initial = self._request(
                fixture.port,
                [{"role": "user", "content": "run the governed tool"}],
            )
            continuation = self._request(
                fixture.port,
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
                        "content": "fixture result",
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

    def test_fixture_cleanup_is_safe_before_start(self) -> None:
        fixture = OpenAIProviderFixture()

        fixture.stop()

        self.assertFalse(fixture.started)

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
        self.assertNotIn("agent_v2_gate.py", source)
        self.assertNotIn("reset_fixture", source)

    @staticmethod
    def _request(port: int, messages: list[dict[str, object]]) -> str:
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
                "Authorization": f"Bearer {FIXTURE_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.read().decode("utf-8")


if __name__ == "__main__":
    unittest.main(verbosity=2)
