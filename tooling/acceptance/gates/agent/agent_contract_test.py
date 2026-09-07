from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _exists(relative: str) -> bool:
    return (ROOT / relative).is_file()


class AgentToolCallStateMachineTest(unittest.TestCase):
    def test_tool_call_has_all_eleven_states(self) -> None:
        source = _read("model/domain/agent/agent.proto")
        required_states = [
            "TOOL_CALL_STATUS_PROPOSED",
            "TOOL_CALL_STATUS_WAITING_APPROVAL",
            "TOOL_CALL_STATUS_APPROVED",
            "TOOL_CALL_STATUS_DENIED",
            "TOOL_CALL_STATUS_CLAIMED",
            "TOOL_CALL_STATUS_RUNNING",
            "TOOL_CALL_STATUS_SUCCEEDED",
            "TOOL_CALL_STATUS_FAILED",
            "TOOL_CALL_STATUS_CANCELLED",
            "TOOL_CALL_STATUS_EXPIRED",
            "TOOL_CALL_STATUS_UNKNOWN_SIDE_EFFECT",
        ]
        for state in required_states:
            with self.subTest(state=state):
                self.assertIn(state, source)

    def test_fencing_token_used_for_claim_and_result(self) -> None:
        persistence = _read("apps/station/app/subserver/agent/infrastructure/persistence/tool_call.go")
        transport = _read(
            "apps/desktop/src-tauri/src/application/desktop_executor_worker/station_transport.rs"
        )
        self.assertIn("ExecutionClaimID", persistence)
        self.assertIn("FencingToken", persistence)
        self.assertIn("ClientCapabilityReceipt", transport)
        self.assertIn("submit_active", transport)
        self.assertIn("ACTIVE_RECEIPT_PATH", transport)

    def test_expiry_sweeper_exists(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/tool_dispatch_service.go")
        self.assertIn("ExpireStaleApprovals", source)

    def test_arguments_redacted_in_persistence(self) -> None:
        dispatch = _read("apps/station/app/subserver/agent/service/tool_dispatch_service.go")
        redaction = _read("apps/station/app/subserver/agent/service/diagnostic_redaction.go")
        coverage = _read("apps/station/app/subserver/agent/service/turn_evidence_test.go")
        self.assertIn("redactArguments(string(call.Arguments))", dispatch)
        self.assertIn("func TestRedactArgumentsSanitizesDiagnosticPayload", coverage)
        for keyword in ("api_key", "token", "password", "secret", "credential"):
            with self.subTest(keyword=keyword):
                self.assertIn(keyword, redaction)

    def test_tool_iteration_budget_exists(self) -> None:
        contract = _read("model/domain/agent/agent.proto")
        service = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("uint32 max_tool_calls", contract)
        self.assertIn("uint32 max_identical_tool_calls", contract)
        self.assertIn("budget.GetMaxToolCalls()", service)
        self.assertIn("maxToolCallsExhaustedReason", service)

    def test_wall_time_budget_exists(self) -> None:
        contract = _read("model/domain/agent/agent.proto")
        service = _read("apps/station/app/subserver/agent/service/turn_service.go")
        coverage = _read("apps/station/app/subserver/agent/service/turn_runtime_budget_test.go")
        self.assertIn("uint64 wall_time_ms", contract)
        self.assertIn("withRuntimeBudgetDeadline", service)
        self.assertIn("TestWallTimeDeadlineRetainsTypedBudgetExhaustion", coverage)


class AgentEventProtocolTest(unittest.TestCase):
    def test_tool_proposal_event_in_streaming_types(self) -> None:
        source = _read("apps/desktop/src/store/streaming/types.ts")
        self.assertIn("'tool_approval_required'", source)
        self.assertIn("ToolApprovalRequiredPayload", source)

    def test_tool_proposal_handler_in_streaming_handler(self) -> None:
        source = _read("apps/desktop/src/runtimes/toolRuntime.ts")
        self.assertIn("event.event === 'tool_approval_required'", source)
        self.assertIn("decisionRevision", source)
        self.assertIn("payloadHash", source)

    def test_budget_exhausted_handled(self) -> None:
        service = _read("apps/station/app/subserver/agent/service/turn_service.go")
        coverage = _read("apps/station/app/subserver/agent/service/turn_event_test.go")
        handler = _read("apps/desktop/src/store/streaming/handler.ts")
        self.assertIn("runtimeBudgetExhaustionReason", service)
        self.assertIn("AgentToolBudgetExhausted", coverage)
        self.assertIn("case 'error'", handler)
        self.assertIn("terminalStatus: 'failed'", handler)

    def test_budget_notice_on_chat_message(self) -> None:
        source = _read("apps/desktop/src/components/messages/AssistantMessage.tsx")
        self.assertIn(
            "data-budget-notice",
            source,
            "assistant messages must expose the stable budget-notice selector",
        )

    def test_cancellation_event_carries_station_owned_typed_outcome(self) -> None:
        contract = _read("model/domain/agent/turn_stream.proto")
        station = _read("apps/station/app/subserver/agent/service/turn_service.go")
        message_projection = _read(
            "apps/station/app/subserver/agent/handler/conversation_handler.go"
        )
        projection = _read("apps/desktop/src/store/streaming/handler.ts")
        cache_projection = _read(
            "apps/desktop/src/storage/desktopAgentChatCache.ts"
        )
        self.assertRegex(
            contract,
            r"message CancelledPayload \{[^}]*ErrorPayload outcome_error = 2;",
        )
        self.assertIn("OutcomeError:   outcomeErrorJSON", station)
        self.assertIn(
            'errcode.NewLifecycleCancelledPayload("turn", turnID)',
            station,
        )
        self.assertIn('item["error_json"]', message_projection)
        self.assertIn("cancellationTypedError(d)", projection)
        self.assertIn("terminalStatus: 'cancelled'", projection)
        self.assertIn("errorJson: message.error_json", cache_projection)


class AgentDeadCodeRemovalTest(unittest.TestCase):
    def test_no_legacy_sse_approval_interception_in_rust(self) -> None:
        source = _read("apps/desktop/src-tauri/src/application/agent_turn/mod.rs")
        self.assertNotIn("wait_for_tool_approval", source)
        self.assertNotIn("tool_approval_registry", source)
        self.assertNotIn("resolve_and_submit_local_tool_request", source)
        self.assertNotIn("ApprovalWaiter", source)
        self.assertNotIn("TOOL_APPROVAL_TIMEOUT", source)

    def test_no_legacy_decide_tool_approval_command(self) -> None:
        commands = _read("apps/desktop/src-tauri/src/main.rs")
        transport = _read(
            "apps/desktop/src-tauri/src/application/desktop_executor_worker/station_transport.rs"
        )
        self.assertNotIn("agent_decide_tool_approval", commands)
        self.assertIn("agent_submit_tool_decision", commands)
        self.assertIn('"/sub-agent/agent/capability/requests/pull"', transport)
        self.assertIn('"/sub-agent/agent/capability/receipt"', transport)
        self.assertIn('"/sub-agent/agent/capability/receipt/recover"', transport)

    def test_no_legacy_agent_tool_approval_in_contracts(self) -> None:
        source = _read("apps/desktop/src-tauri/src/contracts.rs")
        self.assertNotIn("AgentToolApprovalDecisionInput", source)

    def test_no_legacy_decide_api_in_desktop_api(self) -> None:
        source = _read("apps/desktop/src/services/desktop_api.ts")
        self.assertNotIn("decideAgentToolApproval", source)
        self.assertIn("AgentToolDecisionIntentInput", source)
        self.assertIn("submitAgentToolDecision", source)
        self.assertIn("'agent_submit_tool_decision'", source)


class AgentContextLedgerTest(unittest.TestCase):
    def test_complete_canonical_context_ledger_is_persisted(self) -> None:
        contract = _read("model/domain/agent/agent.proto")
        producers = "\n".join(
            [
                _read("apps/station/app/subserver/agent/service/prompt_assembly_service.go"),
                _read("apps/station/app/subserver/agent/service/turn_service.go"),
                _read("apps/station/app/subserver/agent/service/attachment_admission_service.go"),
            ]
        )
        required_types = [
            "CONTEXT_SEGMENT_TYPE_IDENTITY",
            "CONTEXT_SEGMENT_TYPE_POLICY",
            "CONTEXT_SEGMENT_TYPE_MODEL_FACTS",
            "CONTEXT_SEGMENT_TYPE_MEMORY",
            "CONTEXT_SEGMENT_TYPE_SKILL_INDEX",
            "CONTEXT_SEGMENT_TYPE_SKILL_BODY",
            "CONTEXT_SEGMENT_TYPE_HISTORY",
            "CONTEXT_SEGMENT_TYPE_SUMMARY",
            "CONTEXT_SEGMENT_TYPE_KNOWLEDGE",
            "CONTEXT_SEGMENT_TYPE_WORKSPACE_REFERENCE",
            "CONTEXT_SEGMENT_TYPE_ATTACHMENT",
            "CONTEXT_SEGMENT_TYPE_TOOL_SCHEMA",
            "CONTEXT_SEGMENT_TYPE_CURRENT_INPUT",
        ]
        missing_contract = [segment_type for segment_type in required_types if segment_type not in contract]
        missing_producers = [segment_type for segment_type in required_types if segment_type not in producers]
        self.assertEqual([], missing_contract, f"canonical ContextLedger types missing: {missing_contract}")
        ledger_fields = (
            "ContextLedgerId:",
            "TurnId:",
            "AttemptId:",
            "Segments:",
            "EstimatedInputTokens:",
            "ReservedOutputTokens:",
            "ModelContextWindow:",
            "PromptHash:",
            "PromptVersion:",
        )
        missing_ledger_fields = [field for field in ledger_fields if field not in producers]
        self.assertEqual([], missing_producers, f"canonical segment producers missing: {missing_producers}")
        self.assertIn(
            "model.ContextLedger{",
            producers,
            f"canonical ContextLedger envelope is not persisted; missing fields: {missing_ledger_fields}",
        )
        self.assertEqual([], missing_ledger_fields, f"canonical ContextLedger fields missing: {missing_ledger_fields}")

    def test_context_ledger_persisted_in_turn_trace(self) -> None:
        attempt = _read("apps/station/app/subserver/agent/infrastructure/persistence/turn_attempt.go")
        service = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("ContextLedger string", attempt)
        self.assertIn("func (s *TurnService) persistContextLedger", service)
        self.assertIn('Update("context_ledger", string(ledgerJSON))', service)

    def test_context_ledger_field_in_domain(self) -> None:
        source = _read("model/domain/agent/agent.proto")
        ledger_match = re.search(r"message ContextLedger \{([^}]+)\}", source, re.DOTALL)
        self.assertIsNotNone(ledger_match)
        ledger = ledger_match.group(1)
        self.assertIn("repeated ContextSegment segments", ledger)
        self.assertIn("string attempt_id", ledger)
        self.assertIn("string prompt_hash", ledger)


class AgentAttachmentTest(unittest.TestCase):
    def test_opaque_attachment_id_prefix(self) -> None:
        service = _read("apps/station/app/subserver/agent/service/attachment_admission_service.go")
        self.assertIn('agentAttachmentObjectPrefix = "oss:"', service)
        self.assertIn("attachmentObjectKey", service)
        self.assertIn("attachment object_ref must be an opaque OSS reference", service)

    def test_attachment_size_limit(self) -> None:
        contract = _read("model/domain/agent/agent.proto")
        service = _read("apps/station/app/subserver/agent/service/attachment_admission_service.go")
        self.assertIn("uint64 attachment_bytes", contract)
        self.assertIn("uint64 max_attachment_bytes", contract)
        self.assertIn("budget.GetMaxAttachmentBytes()", service)
        self.assertIn("totalBytes > maxBytes", service)

    def test_storage_key_not_exposed_in_ref(self) -> None:
        source = _read("model/domain/agent/agent.proto")
        ref_match = re.search(
            r"message AgentAttachmentRef \{([^}]+)\}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(ref_match)
        self.assertIn("string object_ref", ref_match.group(1))
        self.assertNotIn("storage_key", ref_match.group(1))
        self.assertNotIn("storage_path", ref_match.group(1))

    def test_mime_type_whitelist(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/attachment_admission_service.go")
        self.assertIn("func attachmentMimeAllowed", source)
        self.assertIn('"image/png", "application/pdf"', source)
        self.assertIn("attachmentContentMatches", source)


class AgentDiagnosticsTest(unittest.TestCase):
    def test_diagnostic_export_endpoint_exists(self) -> None:
        routes = _read("apps/station/app/subserver/agent/agent.go")
        handler = _read("apps/station/app/subserver/agent/handler/turn_handler.go")
        self.assertIn('"/agent/turn/diagnostics/export"', routes)
        self.assertIn("HandleExportTurnDiagnostics", handler)

    def test_diagnostic_export_redacts_arguments(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_evidence_service.go")
        coverage = _read("apps/station/app/subserver/agent/service/turn_evidence_test.go")
        self.assertIn("redactDiagnosticText", source)
        self.assertIn("ContentHash", source)
        self.assertNotIn("BoundedArguments", source)
        self.assertIn("TestTurnServiceExportTurnDiagnostics", coverage)
        self.assertIn("cross-actor diagnostic export must fail", coverage)

    def test_turn_details_view_component_exists(self) -> None:
        desktop_api = _read("apps/desktop/src/services/desktop_api.ts")
        desktop_surface = "\n".join(
            _read(path)
            for path in (
                "apps/desktop/src/components/messages/AssistantMessage.tsx",
                "apps/desktop/src/components/portal/PortalPanel.tsx",
            )
        )
        self.assertIn("exportAgentTurnDiagnostics", desktop_api)
        self.assertIn(
            "data-agent-turn-details",
            desktop_surface,
            "turn details/export must expose the stable turn-details selector",
        )

    def test_source_attribution_badges_in_assistant_message(self) -> None:
        source = _read("apps/desktop/src/components/messages/AssistantMessage.tsx")
        self.assertIn(
            "data-source-badges",
            source,
            "assistant messages must expose the stable source-badge group selector",
        )
        self.assertIn("data-source-badge", source)

    def test_capability_warning_in_chat_input(self) -> None:
        source = _read("apps/desktop/src/components/ChatInput.tsx")
        self.assertIn(
            "data-agent-capability-warning",
            source,
            "the composer must expose the stable capability-warning selector",
        )


class AgentLineageTest(unittest.TestCase):
    def test_replaces_message_id_in_turn_config(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("ReplacesMessageID", source)
        self.assertIn("BranchID", source)

    def test_persist_message_with_lineage_method(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("persistMessageWithLineage", source)

    def test_desktop_sends_replaces_message_id(self) -> None:
        contract = _read("apps/desktop/src/services/desktop_api.ts")
        store = _read("apps/desktop/src/store/chat.ts")
        self.assertIn("replaces_message_id?: string", contract)
        self.assertIn("api.regenerateAgentTurn", store)
        self.assertIn("api.editAndResendAgentMessage", store)


class AgentRuntimeCapabilityTest(unittest.TestCase):
    def test_capability_snapshot_type_exists(self) -> None:
        source = _read("model/domain/agent/agent.proto")
        self.assertIn("message RuntimeCapabilitySnapshot", source)
        for field in (
            "RuntimeInputCapabilities input",
            "RuntimeOutputCapabilities output",
            "RuntimeExecutionCapabilities runtime",
            "RuntimeAgenticCapabilities agentic",
            "RuntimeCapabilityLimits limits",
            "RuntimeCapabilityProvenance provenance",
        ):
            with self.subTest(field=field):
                self.assertIn(field, source)

    def test_capability_snapshot_persisted_in_trace(self) -> None:
        source = _read("apps/station/app/subserver/agent/domain/turn.go")
        self.assertIn("CapabilitySnapshot", source)


class AgentToolRuntimeTest(unittest.TestCase):
    def test_tool_runtime_singleton_exists(self) -> None:
        self.assertTrue(
            _exists("apps/desktop/src/runtimes/toolRuntime.ts"),
            "toolRuntime.ts must exist",
        )

    def test_tool_runtime_handles_approve_and_deny(self) -> None:
        source = _read("apps/desktop/src/runtimes/toolRuntime.ts")
        self.assertIn("submitDecision(toolCallId: string, approved: boolean)", source)
        self.assertIn("status: approved ? 'approved' : 'denied'", source)
        self.assertIn("event.event === 'tool_approval_required'", source)

    def test_station_tool_routes_registered(self) -> None:
        source = _read("apps/station/app/subserver/agent/agent.go")
        for route in (
            "/agent/tool/decision",
            "/agent/capability/lease/register",
            "/agent/capability/requests/pull",
            "/agent/capability/receipt",
            "/agent/capability/receipt/recover",
            "/agent/turn/diagnostics/export",
        ):
            with self.subTest(route=route):
                self.assertIn(route, source)


class AgentPersistenceModelsTest(unittest.TestCase):
    def test_tool_call_model_registered(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/models.go")
        self.assertIn("ToolCall{}", source)

    def test_attachment_model_registered(self) -> None:
        models = _read("apps/station/app/subserver/agent/infrastructure/persistence/models.go")
        message = _read("apps/station/app/subserver/agent/infrastructure/persistence/message.go")
        self.assertNotIn("AgentAttachment{}", models)
        self.assertIn("AttachmentsJSON", message)
        self.assertIn("AgentMessage{}", models)


class AgentUnitTestCoverageTest(unittest.TestCase):
    """Verify that real Go unit tests exist for critical logic, not just structural assertions."""

    def test_pre_admission_tests_exist(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_admission_service_test.go")
        for test in [
            "TestTurnAdmissionRejectsAttachmentBeforePersistence",
            "TestTurnAdmissionRejectsInputOverflowBeforePersistence",
            "TestTurnAdmissionReplaysBeforeAttachmentRevalidation",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)

    def test_tool_dispatch_tests_exist(self) -> None:
        path = ROOT / "apps/station/app/subserver/agent/service/tool_dispatch_service_test.go"
        self.assertTrue(path.is_file(), "tool_dispatch_service_test.go must exist")
        source = path.read_text(encoding="utf-8")
        for test in [
            "TestToolDispatchServiceProposeAuthorizedBatchUsesCapabilityAuthority",
            "TestStationToolPolicyBlocksExecutionUntilApproved",
            "TestTurnServiceExecutesAuthorizedStationToolExactlyOnce",
            "TestToolDispatchServiceRejectsInvalidReceiptAuthority",
            "TestToolDispatchServiceSettleExpiredToolCalls",
            "TestToolDispatchServiceTerminalReceiptRollsBackAtomically",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)

    def test_attachment_service_tests_exist(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/attachment_admission_service_test.go")
        for test in [
            "TestAttachmentAdmissionAcceptsActorPrivateObject",
            "TestAttachmentAdmissionRejectsInvalidAuthorityAndMetadata",
            "TestAttachmentAdmissionRejectsSpoofedMimeContent",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)

    def test_capability_snapshot_tests_exist(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/runtime_admission_service_test.go")
        for test in [
            "TestRuntimeAdmissionSnapshotIDChangesWithInputCapabilities",
            "TestRuntimeCapabilitySnapshotUsesCatalogProviderProtocol",
            "TestRuntimeAdmissionDoesNotInferReasoningFromModelName",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)


if __name__ == "__main__":
    unittest.main()
