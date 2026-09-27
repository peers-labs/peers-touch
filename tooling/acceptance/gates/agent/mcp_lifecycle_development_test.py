from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.mcp_lifecycle_development import (
    MCP_BLOCK_ON_LAUNCH,
    MCP_FIXTURE_SCRIPT,
    MCP_RESULT_TEXT,
    MCP_TOOL_NAME,
    McpLifecycleDevelopmentError,
    ROOT,
    evaluate_mcp_lifecycle,
    inspect_mcp_fixture,
)


def valid_prepared() -> dict[str, object]:
    return {
        "assertions": {
            "manifestAndConfigurationVisible": True,
            "installTestConnectSucceeded": True,
            "authoritativeBindingReady": True,
            "governedMcpInvocationSucceeded": True,
            "cancellationVisibleAndTerminal": True,
            "retryRestoredConnection": True,
            "stationReplayEqual": True,
            "toolLineageComplete": True,
        },
    }


def valid_recovered() -> dict[str, object]:
    return {
        "assertions": {
            "restartInvalidatedConnection": True,
            "priorOperationsRemainTerminal": True,
            "bindingSurvivedRestart": True,
            "reconnectRestoredConnection": True,
            "cleanupComplete": True,
        },
        "cleanup": {"status": "clean"},
    }


def valid_provider_requests() -> list[dict[str, object]]:
    return [
        {
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": False,
            "hasExpectedToolResult": False,
            "toolNames": ["local_mcp"],
        },
        {
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": True,
            "hasExpectedToolResult": True,
            "toolNames": ["local_mcp"],
        },
    ]


def valid_process_evidence() -> dict[str, object]:
    return {
        "launchCount": 6,
        "expectedLaunchCount": 6,
        "sideEffectCount": 1,
        "secretDigestMatched": True,
        "blockedProcess": {
            "launch": MCP_BLOCK_ON_LAUNCH,
            "alive": False,
            "portOpen": False,
        },
        "allProcessesReaped": True,
        "allPortsReleased": True,
    }


class McpLifecycleDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_lifecycle(self) -> None:
        assertions = evaluate_mcp_lifecycle(
            valid_prepared(),
            valid_recovered(),
            valid_provider_requests(),
            valid_process_evidence(),
            canary_leaked=False,
        )

        self.assertTrue(all(assertions.values()))

    def test_rejects_secret_leak(self) -> None:
        with self.assertRaisesRegex(
            McpLifecycleDevelopmentError,
            "secretCanaryProtected",
        ):
            evaluate_mcp_lifecycle(
                valid_prepared(),
                valid_recovered(),
                valid_provider_requests(),
                valid_process_evidence(),
                canary_leaked=True,
            )

    def test_rejects_unreaped_cancelled_process(self) -> None:
        process = copy.deepcopy(valid_process_evidence())
        process["blockedProcess"]["alive"] = True
        process["allProcessesReaped"] = False

        with self.assertRaisesRegex(
            McpLifecycleDevelopmentError,
            "cancelledProcessReaped",
        ):
            evaluate_mcp_lifecycle(
                valid_prepared(),
                valid_recovered(),
                valid_provider_requests(),
                process,
                canary_leaked=False,
            )

    def test_stdio_fixture_reports_tool_and_side_effect_without_secret(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mca-j04-fixture-test-") as raw:
            root = Path(raw)
            script = root / "server.py"
            script.write_text(MCP_FIXTURE_SCRIPT + "\n", encoding="utf-8")
            secret = "mca-j04-secret-unit-test-value"
            environment = os.environ.copy()
            environment.update(
                {
                    "MCA_J04_STATE_DIR": str(root),
                    "MCA_J04_SECRET_CANARY": secret,
                    "MCA_J04_BLOCK_ON_LAUNCH": "99",
                    "MCA_J04_TOOL_NAME": MCP_TOOL_NAME,
                    "MCA_J04_RESULT_TEXT": MCP_RESULT_TEXT,
                }
            )
            process = subprocess.Popen(
                [sys.executable, str(script)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
            )
            try:
                self._write_frame(
                    process,
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {},
                    },
                )
                initialize = self._read_frame(process)
                self._write_frame(
                    process,
                    {
                        "jsonrpc": "2.0",
                        "method": "notifications/initialized",
                    },
                )
                self._write_frame(
                    process,
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/list",
                        "params": {},
                    },
                )
                tools = self._read_frame(process)
                self._write_frame(
                    process,
                    {
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "tools/call",
                        "params": {
                            "name": MCP_TOOL_NAME,
                            "arguments": {"sample": "unit"},
                        },
                    },
                )
                result = self._read_frame(process)
            finally:
                process.kill()
                process.wait(timeout=5)
                if process.stdin is not None:
                    process.stdin.close()
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()

            (root / "blocked-process.json").write_text(
                (root / "process-1.json").read_text(encoding="utf-8"),
                encoding="utf-8",
            )

            evidence = inspect_mcp_fixture(
                root,
                expected_secret_digest=hashlib.sha256(
                    secret.encode("utf-8")
                ).hexdigest(),
                expected_launch_count=1,
            )
            self.assertEqual(
                initialize["result"]["protocolVersion"],
                "2024-11-05",
            )
            self.assertEqual(
                tools["result"]["tools"][0]["name"],
                MCP_TOOL_NAME,
            )
            self.assertIn(
                MCP_RESULT_TEXT,
                result["result"]["content"][0]["text"],
            )
            self.assertEqual(evidence["sideEffectCount"], 1)
            self.assertTrue(evidence["secretDigestMatched"])
            self.assertTrue(evidence["allProcessesReaped"])
            self.assertTrue(evidence["allPortsReleased"])
            self.assertNotIn(secret, json.dumps(evidence, sort_keys=True))

    def test_runner_uses_profile_two_single_native_restart_and_harness(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "mcp_lifecycle_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn("AGENT_V2_MCP_GATE", source)
        self.assertIn('"runMcpLifecycleDevelopment"', source)
        self.assertIn("runtime_client.restart()", source)
        self.assertIn("inspect_mcp_fixture(", source)
        self.assertIn("MCA_J04_SECRET_CANARY", source)
        self.assertIn("OPERATION_SCENARIO_ACTOR_ACCOUNT", source)
        self.assertIn("OPERATION_SCENARIO_IDENTITY_FIXTURE", source)
        self.assertIn('"providerApiKey": provider_fixture.api_key', source)
        self.assertNotIn("agent_v2_gate.py", source)
        self.assertNotIn("J02_ACTOR_ACCOUNT", source)
        self.assertNotIn("J02_IDENTITY_FIXTURE", source)
        self.assertNotIn("reset_fixture", source)
        enrollment = source.find("confirm_native_actor_identity_enrollment(")
        persistence = source.find(
            "persist_native_actor_identity(",
            enrollment,
        )
        journey = source.find('"runMcpLifecycleDevelopment"', persistence)
        self.assertGreaterEqual(enrollment, 0)
        self.assertGreater(persistence, enrollment)
        self.assertGreater(journey, persistence)

    def test_native_receiver_expands_terminal_tool_group_before_item_assertion(
        self,
    ) -> None:
        source = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        journey = source[
            source.index("async function prepareMcpLifecycleDevelopmentJourney("):
            source.index("async function recoverMcpLifecycleDevelopmentJourney(")
        ]

        group_selector = journey.find(
            "const toolCallGroupSelector ="
        )
        group_assertion = journey.find(
            "'MCP ToolCall native receiver group'",
            max(group_selector, 0),
        )
        group_toggle = journey.find(
            "'[data-pt-agent-tool-call-group-toggle]'",
            max(group_assertion, 0),
        )
        item_assertion = journey.find(
            "'MCP ToolCall native receiver'",
            max(group_toggle, 0),
        )

        self.assertGreaterEqual(group_selector, 0)
        self.assertGreaterEqual(group_assertion, 0)
        self.assertGreaterEqual(group_toggle, 0)
        self.assertGreaterEqual(item_assertion, 0)
        self.assertLess(group_selector, group_assertion)
        self.assertLess(group_assertion, group_toggle)
        self.assertLess(group_toggle, item_assertion)
        self.assertNotIn(
            "receiver state after diagnostic authoritative sync",
            journey,
        )
        self.assertIn(
            "JSON.stringify(conversationReadback.messages)"
            ".includes(toolCallId)",
            journey.replace("\n", "").replace(" ", ""),
        )
        self.assertNotIn(
            "conversationReadback.messages)\n"
            "          .includes(input.expectedResult)",
            journey,
        )

    def test_operation_evidence_hashes_idempotency_key(self) -> None:
        source = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        projection = source[
            source.index("async function mcpOperationEvidence("):
            source.index("function currentMcpOperation(")
        ]

        self.assertIn(
            "idempotencyKeyHash: await sha256Hex(operation.idempotencyKey)",
            projection,
        )
        self.assertNotIn(
            "idempotencyKey: operation.idempotencyKey",
            projection,
        )

    def test_candidate_receipt_preserves_station_fencing_token(self) -> None:
        source = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        prepared = source[
            source.index("async function prepareMcpLifecycleDevelopmentJourney("):
            source.index("async function runMcpDesktopCandidateScenario(")
        ]
        candidate = source[
            source.index("async function runMcpDesktopCandidateScenario("):
            source.index("async function runMcpLifecycleScenario(")
        ]
        tool_call_binding = prepared[
            prepared.index("toolCallBinding: {"):
            prepared.index("const assertions =")
        ]

        self.assertNotIn("fencingToken:", tool_call_binding)
        self.assertIn(
            "fencingToken: Number(toolLineage.fencingToken)",
            candidate,
        )

    @staticmethod
    def _write_frame(
        process: subprocess.Popen[bytes],
        payload: dict[str, object],
    ) -> None:
        assert process.stdin is not None
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        process.stdin.write(
            f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body
        )
        process.stdin.flush()

    @staticmethod
    def _read_frame(process: subprocess.Popen[bytes]) -> dict[str, object]:
        assert process.stdout is not None
        content_length = 0
        while True:
            line = process.stdout.readline()
            if not line:
                raise AssertionError("fixture closed before response")
            header = line.rstrip(b"\r\n")
            if not header:
                break
            if header.lower().startswith(b"content-length:"):
                content_length = int(header.split(b":", 1)[1].strip())
        payload = json.loads(process.stdout.read(content_length))
        if not isinstance(payload, dict):
            raise AssertionError("fixture response must be an object")
        return payload


if __name__ == "__main__":
    unittest.main(verbosity=2)
