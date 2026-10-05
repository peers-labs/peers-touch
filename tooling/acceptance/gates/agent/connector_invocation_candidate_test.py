from __future__ import annotations

import json
import subprocess
import unittest
from datetime import datetime, timezone

from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2RolePolicy,
    AgentV2RuntimeTuple,
)
from tooling.acceptance.gates.agent.connector_invocation_candidate import (
    MOBILE_MARKER,
    ConnectorInvocationCandidateError,
    ConnectorInvocationMobileAdapter,
    ROOT,
    _is_zero_execution_tuple,
    _validate_runtime_tuple_policy,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_CONNECTOR_GATE,
)


def runtime_tuple(
    *,
    cell: str,
    ordering: str = "single",
    profile: str,
    roles: tuple[str, ...],
) -> AgentV2RuntimeTuple:
    return AgentV2RuntimeTuple(
        gate=AGENT_V2_CONNECTOR_GATE,
        row="connector-test",
        platform="desktop_app",
        runtime="direct_model",
        cell=cell,
        locale="en",
        ordering=ordering,
        sample_id="sample-001",
        role_policy=AgentV2RolePolicy((), roles, ()),
        runtime_attestation_profile=profile,
    )


class ConnectorInvocationCandidateTest(unittest.TestCase):
    def test_matrix_has_37_unique_tuples_with_exact_role_partition(self) -> None:
        assembler = AgentV2CandidateAssembler(AGENT_V2_CONNECTOR_GATE)

        self.assertEqual(len(assembler.runtime_tuples), 37)
        self.assertEqual(
            len({runtime_tuple.key for runtime_tuple in assembler.runtime_tuples}),
            37,
        )
        for item in assembler.runtime_tuples:
            if item.platform == "mobile_contract":
                self.assertEqual(
                    item.role_policy.adapter_roles,
                    frozenset({"contract-evidence", "cleanup"}),
                )
                continue
            _validate_runtime_tuple_policy(item)
            self.assertEqual(
                "zero-execution" in item.role_policy.adapter_roles,
                _is_zero_execution_tuple(item),
            )

    def test_executed_connector_requires_client_capability_attestation(self) -> None:
        _validate_runtime_tuple_policy(
            runtime_tuple(
                cell="AS-06",
                profile="client_capability_turn",
                roles=("receiver-dom",),
            )
        )

        with self.assertRaisesRegex(
            ConnectorInvocationCandidateError,
            "client_capability_turn",
        ):
            _validate_runtime_tuple_policy(
                runtime_tuple(
                    cell="AS-06",
                    profile="station_capability_turn",
                    roles=("receiver-dom",),
                )
            )

    def test_rejected_connector_requires_zero_execution(self) -> None:
        _validate_runtime_tuple_policy(
            runtime_tuple(
                cell="ERR-CON01",
                profile="station_turn",
                roles=("receiver-dom", "zero-execution"),
            )
        )

        with self.assertRaisesRegex(
            ConnectorInvocationCandidateError,
            "zero-execution applicability drifted",
        ):
            _validate_runtime_tuple_policy(
                runtime_tuple(
                    cell="R-06",
                    ordering="A",
                    profile="station_turn",
                    roles=("receiver-dom",),
                )
            )

    def test_mobile_contract_adapter_emits_no_runtime_roles(self) -> None:
        report = {
            "testResults": [{
                "assertionResults": [{
                    "fullName": f"contracts {MOBILE_MARKER}",
                    "status": "passed",
                }],
            }],
        }

        def runner(*_args, **_kwargs):
            return subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(report),
                stderr="",
            )

        item = AgentV2CandidateAssembler(
            AGENT_V2_CONNECTOR_GATE
        ).runtime_tuples[-1]
        observation = ConnectorInvocationMobileAdapter(
            runner=runner,
            now=lambda: datetime(2026, 9, 21, tzinfo=timezone.utc),
        ).observe(item)

        self.assertEqual(
            set(observation.role_observations),
            {"contract-evidence", "cleanup"},
        )
        self.assertEqual(
            observation.runtime_attestation.profile,
            "contract_only",
        )

    def test_entrypoint_and_harness_use_formal_connector_path(self) -> None:
        runner = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "connector_invocation_development.py"
        ).read_text(encoding="utf-8")
        candidate = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "connector_invocation_candidate.py"
        ).read_text(encoding="utf-8")
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")

        self.assertIn('sys.argv[1:] == ["--formal-candidate"]', runner)
        self.assertIn('"runConnectorInvocationScenario"', candidate)
        self.assertIn("runConnectorInvocationScenario(", harness)
        self.assertIn("status: 'revocation_unconfirmed'", harness)
        self.assertIn("'zero-execution'", harness)
        self.assertNotIn("stationExecutorAttestation", candidate)

    def test_connector_refreshes_capability_session_after_oauth_changes(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        journey = harness.split(
            "async function runConnectorInvocationDevelopmentJourney(",
            maxsplit=1,
        )[1].split("const EVALUATION_SELECTORS", maxsplit=1)[0]

        connected = journey.index(
            "const connected = await completeConnectorOAuthFixture("
        )
        initial_refresh = journey.index(
            "await refreshConnectorCapabilitySession(",
            connected,
        )
        initial_bind = journey.index(
            "await useAgentConnectorStore.getState().bindConnector(",
            initial_refresh,
        )
        reconnected = journey.index(
            "const reconnected = await completeConnectorOAuthFixture("
        )
        reconnect_refresh = journey.index(
            "await refreshConnectorCapabilitySession(",
            reconnected,
        )
        reconnect_bind = journey.index(
            "await useAgentConnectorStore.getState().bindConnector(",
            reconnect_refresh,
        )

        self.assertLess(connected, initial_refresh)
        self.assertLess(initial_refresh, initial_bind)
        self.assertLess(reconnected, reconnect_refresh)
        self.assertLess(reconnect_refresh, reconnect_bind)

    def test_secondary_connector_oauth_does_not_use_local_mcp_identity_guard(
        self,
    ) -> None:
        gateway = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"
        ).read_text(encoding="utf-8")
        oauth_routes = gateway.split(
            "// OAuth2",
            maxsplit=1,
        )[1].split(
            "// Account",
            maxsplit=1,
        )[0]

        self.assertIn("fn gateway_identity(", gateway)
        self.assertIn("fn gateway_mcp_identity(", gateway)
        self.assertIn("Local MCP is unavailable in the Secondary client", gateway)
        self.assertIn("match gateway_identity(state)", oauth_routes)
        self.assertNotIn("gateway_mcp_identity(state)", oauth_routes)

    def test_platform_handoff_retires_secondary_and_restarts_native_retry(
        self,
    ) -> None:
        candidate = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "connector_invocation_candidate.py"
        ).read_text(encoding="utf-8")
        collect = candidate.split(
            "class ConnectorInvocationCandidateProducer:",
            maxsplit=1,
        )[1].split("def _candidate_root(", maxsplit=1)[0]

        retire = collect.index("self.runtime_adapter.retire_secondary_session()")
        refresh = collect.index(
            "self.runtime_adapter.refresh_native_session()",
            retire,
        )
        retry = collect.index("except BaseException as first_error:")
        retry_refresh = collect.index(
            "self.runtime_adapter.refresh_native_session()",
            retry,
        )

        self.assertLess(retire, refresh)
        self.assertGreater(retry_refresh, retry)

    def test_disconnect_after_dispatch_waits_for_pinned_settlement(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        journey = harness.split(
            "async function runConnectorInvocationDevelopmentJourney(",
            maxsplit=1,
        )[1].split("const EVALUATION_SELECTORS", maxsplit=1)[0]
        dispatch_first = journey.index(
            "if (cell === 'R-06' && ordering === 'B')"
        )
        settlement = journey.index(
            "'Connector dispatch-first settlement'",
            dispatch_first,
        )
        disconnect = journey.index(
            "raceDisconnect = await api.oauth2Disconnect(connectorId)",
            settlement,
        )

        self.assertLess(dispatch_first, settlement)
        self.assertLess(settlement, disconnect)

    def test_receiver_evidence_preserves_visible_terminal_snapshot(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        journey = harness.split(
            "async function runConnectorInvocationDevelopmentJourney(",
            maxsplit=1,
        )[1].split("const EVALUATION_SELECTORS", maxsplit=1)[0]

        terminal_wait = journey.index(
            "'Connector ToolCall terminal native receiver'"
        )
        terminal_text = journey.index(
            "const terminalReceiverText =",
            terminal_wait,
        )
        reconnect = journey.index(
            "const reconnected = await completeConnectorOAuthFixture(",
            terminal_text,
        )
        receiver_role_start = journey.index(
            "'receiver-dom': {",
            reconnect,
        )
        receiver_role_end = journey.index(
            "'station-readback': {",
            receiver_role_start,
        )
        receiver_role = journey[receiver_role_start:receiver_role_end]

        self.assertLess(terminal_wait, terminal_text)
        self.assertLess(terminal_text, reconnect)
        self.assertIn(
            "textHash: await sha256Hex(terminalReceiverText)",
            receiver_role,
        )
        self.assertIn("visible: terminalReceiverVisible", receiver_role)
        self.assertNotIn("getClientRects()", receiver_role)

    def test_provider_revoke_attests_the_oauth_provider(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        journey = harness.split(
            "async function runConnectorInvocationDevelopmentJourney(",
            maxsplit=1,
        )[1].split("const EVALUATION_SELECTORS", maxsplit=1)[0]

        self.assertEqual(journey.count("oauthProviderId: connectorId"), 2)
        self.assertIn(
            "'provider-revoke': {\n"
            "          providerId: connectorId,",
            journey,
        )

    def test_connector_cleanup_releases_every_owned_resource(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        journey = harness.split(
            "async function runConnectorInvocationDevelopmentJourney(",
            maxsplit=1,
        )[1].split("const EVALUATION_SELECTORS", maxsplit=1)[0]

        cleanup = journey.split(
            "cleanupErrors = await runAcceptanceCleanupSteps([",
            maxsplit=1,
        )[1]
        ordered_steps = [
            "name: 'scenario'",
            "name: 'barrier'",
            "name: 'conversation'",
            "name: 'selection'",
            "name: 'bindings'",
            "name: 'agent'",
            "name: 'runtime-fixture'",
            "name: 'connector'",
        ]
        positions = [cleanup.index(step) for step in ordered_steps]

        self.assertEqual(positions, sorted(positions))
        self.assertIn(
            "await api.listAgentCapabilityBindings(disposableAgentId)",
            cleanup,
        )
        self.assertIn("connectorBindingsDeleted", cleanup)
        self.assertIn("cleanupErrors.length === 0", cleanup)
        self.assertRegex(
            journey,
            r"await useAgentStore\.getState\(\)\.loadAgents\(\);\s+"
            r"const agentStore = useAgentStore\.getState\(\);\s+"
            r"const priorSelection = agentStore\.selectedAgent;",
        )
        self.assertRegex(
            cleanup,
            r"eventBus\.publish\(EVENT\.NAVIGATION_REQUESTED, \{\s+"
            r"resource: 'sessions',\s+\}\);\s+"
            r"if \(priorSelection\) \{\s+"
            r"await api\.setSelectedAgent\(priorSelection\);\s+"
            r"useAgentStore\.getState\(\)\.setSelectedAgent\(priorSelection\);",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
