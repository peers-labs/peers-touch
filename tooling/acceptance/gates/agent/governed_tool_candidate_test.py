from __future__ import annotations

import unittest
from types import SimpleNamespace

from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2RolePolicy,
    AgentV2RuntimeTuple,
)
from tooling.acceptance.gates.agent.governed_tool_candidate import (
    CRASH_CELLS,
    FIXTURE_CLIPBOARD_BYTES,
    GovernedToolCandidateError,
    GovernedToolRuntimeAdapter,
    ROOT,
    _validate_runtime_tuple_policy,
)


class _RuntimeClient:
    def __init__(self, *, duplicate_tool_call: bool = False) -> None:
        self.calls: list[dict[str, object]] = []
        self._duplicate_tool_call = duplicate_tool_call

    def harness(
        self,
        method: str,
        payload: dict[str, object],
        *,
        timeout: int,
    ) -> dict[str, object]:
        self.calls.append(payload)
        cell = str(payload["cell"])
        tool_call_id = (
            "tool-call-reused"
            if self._duplicate_tool_call
            else f"tool-call-{cell}"
        )
        return {
            "assertions": {"scenarioPassed": True},
            "runtimeAttestation": {
                "scenarioExecutionId": payload["scenarioExecutionId"],
                "actorIdentityHash": "a" * 64,
                "toolCallBinding": {"toolCallId": tool_call_id},
            },
        }


class _ClipboardAdapter:
    def __init__(self) -> None:
        self.value = b""
        self.write_count = 0

    def read_clipboard(self) -> bytes:
        return self.value

    def write_clipboard(self, value: bytes) -> None:
        self.value = value
        self.write_count += 1


def _runtime_tuple(
    *,
    cell: str = "AS-05",
    platform: str = "desktop_app",
    ordering: str = "single",
    profile: str = "client_capability_turn",
    roles: tuple[str, ...] = ("executor-receipts",),
) -> AgentV2RuntimeTuple:
    return AgentV2RuntimeTuple(
        gate="agent-v2-governed-tool-loop-e2e",
        row="tool-desktop-local",
        platform=platform,
        runtime="direct_model_local_tool",
        cell=cell,
        locale="en",
        ordering=ordering,
        sample_id="sample-001",
        role_policy=AgentV2RolePolicy((), roles, ()),
        runtime_attestation_profile=profile,
    )


def _adapter(
    client: _RuntimeClient,
    clipboard: _ClipboardAdapter | None = None,
) -> GovernedToolRuntimeAdapter:
    adapter = object.__new__(GovernedToolRuntimeAdapter)
    adapter._runtime_pair = SimpleNamespace(native=client, browser=client)
    adapter._run_id = "run-1"
    adapter._local_provider = SimpleNamespace(api_key="local-run-key")
    adapter._station_provider = SimpleNamespace(api_key="station-run-key")
    adapter._local_provider_url = "http://127.0.0.1:10001"
    adapter._station_provider_url = "http://127.0.0.1:10002"
    adapter._native_adapter = clipboard or _ClipboardAdapter()
    adapter.actor_identity_hash = "a" * 64
    return adapter


class GovernedToolCandidateTest(unittest.TestCase):
    def test_desktop_execution_reseeds_owned_clipboard_fixture(self) -> None:
        client = _RuntimeClient()
        clipboard = _ClipboardAdapter()

        _adapter(client, clipboard)._execute(_runtime_tuple())

        self.assertEqual(clipboard.value, FIXTURE_CLIPBOARD_BYTES)
        self.assertEqual(clipboard.write_count, 1)

    def test_browser_execution_does_not_mutate_native_clipboard(self) -> None:
        client = _RuntimeClient()
        clipboard = _ClipboardAdapter()

        _adapter(client, clipboard)._execute(
            _runtime_tuple(
                platform="browser",
                profile="station_capability_turn",
            )
        )

        self.assertEqual(clipboard.value, b"")
        self.assertEqual(clipboard.write_count, 0)

    def test_as05_runs_fresh_crash_execution_for_each_boundary(self) -> None:
        client = _RuntimeClient()

        aggregate = _adapter(client)._fresh_crash_aggregate(_runtime_tuple())

        self.assertEqual(aggregate["cells"], list(CRASH_CELLS))
        self.assertEqual(aggregate["distinctExecutionCount"], len(CRASH_CELLS))
        self.assertEqual(aggregate["distinctToolCallCount"], len(CRASH_CELLS))
        self.assertEqual(
            {str(call["cell"]) for call in client.calls},
            set(CRASH_CELLS),
        )
        self.assertEqual(
            len({str(call["scenarioExecutionId"]) for call in client.calls}),
            len(CRASH_CELLS),
        )
        self.assertTrue(
            all(call["locale"] == "neutral" for call in client.calls)
        )
        self.assertTrue(
            all(call["ordering"] == "single" for call in client.calls)
        )
        self.assertTrue(
            all(call["providerApiKey"] == "local-run-key" for call in client.calls)
        )

    def test_as05_rejects_reused_crash_tool_call_identity(self) -> None:
        with self.assertRaisesRegex(
            GovernedToolCandidateError,
            "reused crash ToolCall identities",
        ):
            _adapter(
                _RuntimeClient(duplicate_tool_call=True)
            )._fresh_crash_aggregate(_runtime_tuple())

    def test_zero_execution_tuple_requires_station_turn_and_zero_role(self) -> None:
        _validate_runtime_tuple_policy(
            _runtime_tuple(
                cell="R-05",
                ordering="A",
                profile="station_turn",
                roles=("zero-execution",),
            )
        )

    def test_zero_execution_tuple_rejects_executor_receipt_profile(self) -> None:
        with self.assertRaisesRegex(
            GovernedToolCandidateError,
            "runtime profile must be station_turn",
        ):
            _validate_runtime_tuple_policy(
                _runtime_tuple(
                    cell="ERR-O01",
                    profile="client_capability_turn",
                )
            )

    def test_executed_race_requires_executor_receipt_role(self) -> None:
        with self.assertRaisesRegex(
            GovernedToolCandidateError,
            "executor receipt applicability drifted",
        ):
            _validate_runtime_tuple_policy(
                _runtime_tuple(
                    cell="R-07",
                    ordering="B",
                    roles=(),
                )
            )

    def test_candidate_uses_operation_identity_fixture(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/governed_tool_candidate.py"
        ).read_text(encoding="utf-8")
        harness = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        governed_journey = harness[
            harness.index("async function runGovernedToolDevelopmentJourney("):
            harness.index("interface CapabilityBindingCandidateFixture")
        ]

        self.assertIn("OPERATION_SCENARIO_ACTOR_ACCOUNT", source)
        self.assertIn("OPERATION_SCENARIO_IDENTITY_FIXTURE", source)
        self.assertIn("seed_native_actor_identity(", source)
        self.assertIn("confirm_native_actor_identity_enrollment(", source)
        self.assertIn('"providerApiKey": (', source)
        self.assertIn("primary failure: {primary_error};", source)
        self.assertIn("_deploy_acceptance_station(profile_env, run.run_id)", source)
        self.assertIn('"PT_AGENT_CAPABILITY_SCENARIO_CONTROL": "1"', source)
        self.assertNotIn("J02_ACTOR_ACCOUNT", source)
        self.assertNotIn("J02_IDENTITY_FIXTURE", source)
        self.assertIn(
            "'governed ToolCall Agent session surface'",
            harness,
        )
        self.assertIn(
            "'governed ToolCall cleanup Agent session surface'",
            harness,
        )
        self.assertIn("toolRuntime.consume(streamEvent);", harness)
        self.assertIn(".applyRecoveredTurnEvent(", harness)
        self.assertEqual(
            governed_journey.count(
                "await reconcileFoundationToolReceiver();",
            ),
            2,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
