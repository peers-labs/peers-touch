from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.connector_invocation_development import (
    CONNECTOR_ID,
    CONNECTOR_TOOL_PREFIX,
    ConnectorInvocationDevelopmentError,
    ROOT,
    evaluate_connector_invocation,
)
from tooling.acceptance.gates.agent.governed_tool_development import (
    OpenAIProviderFixture,
)


def valid_journey() -> dict[str, object]:
    return {
        "assertions": {
            "oauthConnectionProjected": True,
            "resourceManifestVersionedAndCredentialFree": True,
            "bindingAndPolicyReadBack": True,
            "governedInvocationPersistedOnce": True,
            "nativeReceiverVisible": True,
            "decisionAndStationReplayEqual": True,
            "providerRevokeUnconfirmedAndIdempotent": True,
            "disconnectDisabledEveryResource": True,
            "reconnectRebasedBinding": True,
            "connectorSurfaceVisible": True,
            "cleanupComplete": True,
        },
        "receiver-dom": {
            "visible": True,
            "status": "success",
            "connectorVisible": True,
        },
        "station-readback": {
            "entityKind": "connector-tool-call-lineage",
            "sourceHash": "a" * 64,
            "replayHash": "a" * 64,
        },
        "oauth-resource-manifest": {
            "connectionRevision": "3",
            "resourceId": "connection.status",
            "resourceVersion": "connection-status",
            "scopesHash": "b" * 64,
        },
        "provider-revoke": {
            "providerId": CONNECTOR_ID,
            "status": "unconfirmed",
            "errorCode": "CONNECTOR_PROVIDER_REVOKE_UNCONFIRMED",
            "idempotencyKeyHash": "c" * 64,
        },
        "side-effect-count": {
            "counterId": "d" * 64,
            "count": 1,
            "maximum": 1,
        },
        "replay": {
            "sourceHash": "a" * 64,
            "replayHash": "a" * 64,
            "equal": True,
        },
        "cleanup": {"status": "clean"},
    }


def valid_provider_requests() -> list[dict[str, object]]:
    tool_name = f"{CONNECTOR_TOOL_PREFIX}{'a' * 24}"
    return [
        {
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": False,
            "hasExpectedToolResult": False,
            "toolNames": [tool_name],
            "selectedToolName": tool_name,
        },
        {
            "stream": True,
            "authorizationPresent": True,
            "hasToolResult": True,
            "hasExpectedToolResult": True,
            "toolNames": [tool_name],
            "selectedToolName": tool_name,
        },
    ]


class ConnectorInvocationDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_connector_journey(self) -> None:
        assertions = evaluate_connector_invocation(
            valid_journey(),
            valid_provider_requests(),
            credential_field_leaked=False,
        )

        self.assertTrue(all(assertions.values()))

    def test_rejects_duplicate_connector_side_effect(self) -> None:
        journey = copy.deepcopy(valid_journey())
        journey["side-effect-count"]["count"] = 2

        with self.assertRaisesRegex(
            ConnectorInvocationDevelopmentError,
            "oneConnectorSideEffect",
        ):
            evaluate_connector_invocation(
                journey,
                valid_provider_requests(),
                credential_field_leaked=False,
            )

    def test_rejects_missing_provider_revoke_evidence(self) -> None:
        journey = copy.deepcopy(valid_journey())
        journey["provider-revoke"]["idempotencyKeyHash"] = ""

        with self.assertRaisesRegex(
            ConnectorInvocationDevelopmentError,
            "providerRevokeObserved",
        ):
            evaluate_connector_invocation(
                journey,
                valid_provider_requests(),
                credential_field_leaked=False,
            )

    def test_rejects_credential_field_leak(self) -> None:
        with self.assertRaisesRegex(
            ConnectorInvocationDevelopmentError,
            "credentialFieldsProtected",
        ):
            evaluate_connector_invocation(
                valid_journey(),
                valid_provider_requests(),
                credential_field_leaked=True,
            )

    def test_provider_fixture_selects_one_opaque_connector_tool(self) -> None:
        fixture = OpenAIProviderFixture(
            tool_name="",
            tool_name_prefix=CONNECTOR_TOOL_PREFIX,
        )
        try:
            selected = fixture.server.resolve_tool_name([
                "local_clipboard_read",
                f"{CONNECTOR_TOOL_PREFIX}{'b' * 24}",
                f"{CONNECTOR_TOOL_PREFIX}{'a' * 24}",
            ])
            replayed = fixture.server.resolve_tool_name([
                f"{CONNECTOR_TOOL_PREFIX}{'c' * 24}",
            ])
            fixture.reset_tool_selection()
            reset = fixture.server.resolve_tool_name([
                f"{CONNECTOR_TOOL_PREFIX}{'c' * 24}",
            ])
        finally:
            fixture.stop()

        self.assertEqual(
            selected,
            f"{CONNECTOR_TOOL_PREFIX}{'a' * 24}",
        )
        self.assertEqual(replayed, selected)
        self.assertEqual(reset, f"{CONNECTOR_TOOL_PREFIX}{'c' * 24}")

    def test_provider_fixture_selects_connector_named_in_prompt(self) -> None:
        fixture = OpenAIProviderFixture(
            tool_name="",
            tool_name_prefix=CONNECTOR_TOOL_PREFIX,
        )
        requested = f"{CONNECTOR_TOOL_PREFIX}{'b' * 24}"
        try:
            selected = fixture.server.resolve_tool_name(
                [
                    f"{CONNECTOR_TOOL_PREFIX}{'a' * 24}",
                    requested,
                ],
                f"Call {requested} exactly once with {{}}.",
            )
        finally:
            fixture.stop()

        self.assertEqual(selected, requested)

    def test_runner_uses_profile_two_native_harness_and_source_identity(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "connector_invocation_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn("AGENT_V2_CONNECTOR_GATE", source)
        self.assertIn('"runConnectorInvocationDevelopment"', source)
        self.assertIn("source_identity(ROOT)", source)
        self.assertIn("provider_revoke", source)
        self.assertIn("copy_native_runtime_logs(", source)
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
        journey = source.find(
            '"runConnectorInvocationDevelopment"',
            persistence,
        )
        self.assertGreaterEqual(enrollment, 0)
        self.assertGreater(persistence, enrollment)
        self.assertGreater(journey, persistence)


if __name__ == "__main__":
    unittest.main(verbosity=2)
