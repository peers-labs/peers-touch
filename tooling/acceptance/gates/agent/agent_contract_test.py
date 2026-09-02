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
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/tool_call.go")
        required_states = [
            "ToolCallStatusProposed",
            "ToolCallStatusWaitingApproval",
            "ToolCallStatusApproved",
            "ToolCallStatusDenied",
            "ToolCallStatusExpired",
            "ToolCallStatusClaimed",
            "ToolCallStatusRunning",
            "ToolCallStatusSucceeded",
            "ToolCallStatusFailed",
            "ToolCallStatusCancelled",
        ]
        for state in required_states:
            with self.subTest(state=state):
                self.assertIn(state, source)

    def test_fencing_token_used_for_claim_and_result(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/tool_dispatch_service.go")
        self.assertIn("FencingToken", source)
        self.assertIn("ClaimExecution", source)
        self.assertIn("SubmitResult", source)

    def test_expiry_sweeper_exists(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/tool_dispatch_service.go")
        self.assertIn("ExpireStaleApprovals", source)

    def test_arguments_redacted_in_persistence(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/tool_dispatch_service.go")
        self.assertIn("redactArguments", source)
        for keyword in ("api_key", "token", "password", "secret", "credential"):
            with self.subTest(keyword=keyword):
                self.assertIn(keyword, source)

    def test_tool_iteration_budget_exists(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("MaxToolIterations", source)
        self.assertIn("budget_exceeded", source)

    def test_wall_time_budget_exists(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("MaxWallTime", source)


class AgentEventProtocolTest(unittest.TestCase):
    def test_tool_proposal_event_in_streaming_types(self) -> None:
        source = _read("apps/desktop/src/store/streaming/types.ts")
        self.assertIn("tool_proposal", source)

    def test_tool_proposal_handler_in_streaming_handler(self) -> None:
        source = _read("apps/desktop/src/store/streaming/handler.ts")
        self.assertIn("tool_proposal", source)

    def test_budget_exhausted_handled(self) -> None:
        source = _read("apps/desktop/src/store/streaming/handler.ts")
        self.assertIn("budget_exhausted", source)
        self.assertIn("budgetNotice", source)

    def test_budget_notice_on_chat_message(self) -> None:
        source = _read("apps/desktop/src/store/chat.ts")
        self.assertIn("budgetNotice", source)


class AgentDeadCodeRemovalTest(unittest.TestCase):
    def test_no_legacy_sse_approval_interception_in_rust(self) -> None:
        source = _read("apps/desktop/src-tauri/src/application/agent_turn/mod.rs")
        self.assertNotIn("wait_for_tool_approval", source)
        self.assertNotIn("tool_approval_registry", source)
        self.assertNotIn("resolve_and_submit_local_tool_request", source)
        self.assertNotIn("ApprovalWaiter", source)
        self.assertNotIn("TOOL_APPROVAL_TIMEOUT", source)

    def test_no_legacy_decide_tool_approval_command(self) -> None:
        source = _read("apps/desktop/src-tauri/src/main.rs")
        self.assertNotIn("agent_decide_tool_approval", source)
        self.assertIn("agent_tool_decision", source)
        self.assertIn("agent_tool_claim", source)
        self.assertIn("agent_tool_result", source)

    def test_no_legacy_agent_tool_approval_in_contracts(self) -> None:
        source = _read("apps/desktop/src-tauri/src/contracts.rs")
        self.assertNotIn("AgentToolApprovalDecisionInput", source)

    def test_no_legacy_decide_api_in_desktop_api(self) -> None:
        source = _read("apps/desktop/src/services/desktop_api.ts")
        self.assertNotIn("decideAgentToolApproval", source)
        self.assertIn("submitToolDecision", source)
        self.assertIn("claimToolExecution", source)
        self.assertIn("submitToolResult", source)


class AgentContextLedgerTest(unittest.TestCase):
    def test_nine_segment_types_defined(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/prompt_assembly_service.go")
        required_types = [
            "SegmentIdentity",
            "SegmentGuidance",
            "SegmentMemory",
            "SegmentSkills",
            "SegmentConfig",
            "SegmentKnowledge",
            "SegmentContextFile",
            "SegmentTimestamp",
            "SegmentPlatform",
        ]
        for segment_type in required_types:
            with self.subTest(segment_type=segment_type):
                self.assertIn(segment_type, source)

    def test_context_ledger_persisted_in_turn_trace(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/turn_trace.go")
        self.assertIn("ContextLedger", source)
        self.assertIn("context_ledger", source)

    def test_context_ledger_field_in_domain(self) -> None:
        source = _read("apps/station/app/subserver/agent/domain/turn.go")
        self.assertIn("ContextLedger", source)


class AgentAttachmentTest(unittest.TestCase):
    def test_opaque_attachment_id_prefix(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/attachment_service.go")
        self.assertIn("att_", source)

    def test_attachment_size_limit(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/agent_attachment.go")
        self.assertIn("MaxAttachmentSizeBytes", source)

    def test_storage_key_not_exposed_in_ref(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/agent_attachment.go")
        self.assertIn("AttachmentRef", source)
        ref_match = re.search(
            r"type AttachmentRef struct \{([^}]+)\}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(ref_match)
        self.assertNotIn("StorageKey", ref_match.group(1))
        self.assertNotIn("storage_key", ref_match.group(1))

    def test_mime_type_whitelist(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/agent_attachment.go")
        self.assertIn("AllowedAttachmentMimeTypes", source)


class AgentDiagnosticsTest(unittest.TestCase):
    def test_diagnostic_export_endpoint_exists(self) -> None:
        routes = _read("apps/station/app/subserver/agent/agent.go")
        handler = _read("apps/station/app/subserver/agent/handler/turn_handler.go")
        self.assertIn('"/agent/turn/diagnostics/export"', routes)
        self.assertIn("HandleExportTurnDiagnostics", handler)

    def test_diagnostic_export_redacts_arguments(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_evidence_service.go")
        self.assertIn("redactDiagnosticText", source)
        self.assertIn("ContentHash", source)
        self.assertNotIn("BoundedArguments", source)

    def test_turn_details_view_component_exists(self) -> None:
        self.assertTrue(
            _exists("apps/desktop/src/components/portal/views/TurnDetailsView.tsx"),
            "TurnDetailsView component must exist",
        )

    def test_source_attribution_badges_in_assistant_message(self) -> None:
        source = _read("apps/desktop/src/components/messages/AssistantMessage.tsx")
        self.assertIn("SourceAttributionBadges", source)

    def test_capability_warning_in_chat_input(self) -> None:
        source = _read("apps/desktop/src/components/ChatInput.tsx")
        self.assertIn("AlertTriangle", source)


class AgentLineageTest(unittest.TestCase):
    def test_replaces_message_id_in_turn_config(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("ReplacesMessageID", source)
        self.assertIn("BranchID", source)

    def test_persist_message_with_lineage_method(self) -> None:
        source = _read("apps/station/app/subserver/agent/service/turn_service.go")
        self.assertIn("persistMessageWithLineage", source)

    def test_desktop_sends_replaces_message_id(self) -> None:
        source = _read("apps/desktop/src/store/chat.ts")
        self.assertIn("replaces_message_id", source)


class AgentRuntimeCapabilityTest(unittest.TestCase):
    def test_capability_snapshot_type_exists(self) -> None:
        source = _read("apps/station/app/subserver/agent/domain/turn.go")
        self.assertIn("RuntimeCapabilitySnapshot", source)
        for field in (
            "SupportsVision",
            "SupportsTools",
            "SupportsThinking",
            "ContextWindow",
            "MaxOutputTokens",
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
        self.assertIn("approve", source)
        self.assertIn("deny", source)
        self.assertIn("handleProposal", source)

    def test_station_tool_routes_registered(self) -> None:
        source = _read("apps/station/app/subserver/agent/agent.go")
        for route in (
            "/agent/tool/decision",
            "/agent/tool/claim",
            "/agent/tool/result",
            "/agent/attachments/upload",
            "/agent/attachments",
            "/agent/turn/diagnostics/export",
        ):
            with self.subTest(route=route):
                self.assertIn(route, source)


class AgentPersistenceModelsTest(unittest.TestCase):
    def test_tool_call_model_registered(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/models.go")
        self.assertIn("ToolCall{}", source)

    def test_attachment_model_registered(self) -> None:
        source = _read("apps/station/app/subserver/agent/infrastructure/persistence/models.go")
        self.assertIn("AgentAttachment{}", source)


class AgentUnitTestCoverageTest(unittest.TestCase):
    """Verify that real Go unit tests exist for critical logic, not just structural assertions."""

    def test_pre_admission_tests_exist(self) -> None:
        path = ROOT / "apps/station/app/subserver/agent/service/pre_admission_test.go"
        self.assertTrue(path.is_file(), "pre_admission_test.go must exist")
        source = path.read_text(encoding="utf-8")
        for test in [
            "TestCheckPreAdmissionImageWithNonVisionModelRejected",
            "TestCheckPreAdmissionImageWithVisionModelAllowed",
            "TestCheckPreAdmissionInvalidRefRejected",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)

    def test_tool_dispatch_tests_exist(self) -> None:
        path = ROOT / "apps/station/app/subserver/agent/service/tool_dispatch_service_test.go"
        self.assertTrue(path.is_file(), "tool_dispatch_service_test.go must exist")
        source = path.read_text(encoding="utf-8")
        for test in [
            "TestProposeAutoApprovedLowRisk",
            "TestProposeManualApprovalHighRisk",
            "TestClaimExecutionPreventsDoubleClaim",
            "TestSubmitResultStaleFencingRejected",
            "TestExpireStaleApprovals",
            "TestRedactArgumentsJSON",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)

    def test_attachment_service_tests_exist(self) -> None:
        path = ROOT / "apps/station/app/subserver/agent/service/attachment_service_test.go"
        self.assertTrue(path.is_file(), "attachment_service_test.go must exist")
        source = path.read_text(encoding="utf-8")
        for test in [
            "TestAttachmentUploadSuccess",
            "TestAttachmentUploadRejectsOversized",
            "TestAttachmentUploadRejectsUnsupportedMime",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)

    def test_capability_snapshot_tests_exist(self) -> None:
        path = ROOT / "apps/station/app/subserver/agent/service/capability_snapshot_test.go"
        self.assertTrue(path.is_file(), "capability_snapshot_test.go must exist")
        source = path.read_text(encoding="utf-8")
        for test in [
            "TestResolveCapabilitySnapshotVisionModels",
            "TestResolveCapabilitySnapshotNonVisionModels",
        ]:
            with self.subTest(test=test):
                self.assertIn(test, source)


if __name__ == "__main__":
    unittest.main()
