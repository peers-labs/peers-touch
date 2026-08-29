from __future__ import annotations

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling" / "acceptance" / "gates" / "agent" / "native_agent_runner.py"
HARNESS = ROOT / "apps" / "desktop" / "src" / "acceptance" / "agent" / "harness.ts"
CAPABILITY_SUPERVISOR = (
    ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "src"
    / "application"
    / "desktop_executor_worker"
    / "supervisor.rs"
)
DESKTOP_WEB_SCRIPT = ROOT / "tooling" / "scripts" / "dev-desktop-web.sh"
DESKTOP_APP_SCRIPT = ROOT / "tooling" / "scripts" / "dev-desktop-app.sh"
AGENT_CAPABILITY_RUNTIME = (
    ROOT / "apps" / "desktop" / "src" / "runtimes" / "agentCapabilityRuntime.ts"
)
DESKTOP_MAIN = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "main.rs"
FOUNDATION_RUNTIME_CLIENT = (
    ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "agent"
    / "foundation_runtime_client.py"
)
DESKTOP_HTTP_GATEWAY = (
    ROOT / "apps" / "desktop" / "src-tauri" / "src" / "interface" / "http_gateway" / "mod.rs"
)
DESKTOP_API = ROOT / "apps" / "desktop" / "src" / "services" / "desktop_api.ts"
DESKTOP_CONTRACTS = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "contracts.rs"
DESKTOP_AGENT_TURN = (
    ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "src"
    / "application"
    / "agent_turn"
    / "mod.rs"
)


class AgentNativeRunnerStaticTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source = RUNNER.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_runner_file_exists(self) -> None:
        self.assertTrue(RUNNER.is_file(), f"{RUNNER} must exist")

    def test_runner_uses_canonical_tauri_driver(self) -> None:
        self.assertIn("make", self.source)
        self.assertIn("desktop", self.source)
        self.assertIn("PT_DESKTOP_E2E", self.source)
        self.assertIn("webdriver", self.source.lower())

    def test_runner_does_not_invent_env_vars(self) -> None:
        forbidden = ["AGENT_E2E_STATION_URL", "AGENT_E2E_EMAIL", "AGENT_E2E_PASSWORD"]
        for var in forbidden:
            with self.subTest(var=var):
                self.assertNotIn(var, self.source)

    def test_runner_has_no_default_identity_or_station(self) -> None:
        self.assertNotIn("alice@p.t", self.source)
        self.assertNotIn('DEFAULT_PASSWORD = "1"', self.source)
        self.assertNotIn("10.37.", self.source)

    def test_runner_enables_e2e_feature(self) -> None:
        self.assertIn("PT_DESKTOP_E2E", self.source)

    def test_runner_cleans_up_process_and_driver(self) -> None:
        self.assertIn("driver.quit()", self.source)
        self.assertIn("os.killpg", self.source)
        self.assertIn("portsReleased", self.source)
        self.assertIn("storageReleased", self.source)

    def test_runner_emits_evidence_report(self) -> None:
        self.assertIn("ArtifactSession", self.source)
        self.assertNotIn("REPORTS_DIR", self.source)
        self.assertIn("agent-native-journey.json", self.source)
        self.assertIn("startedAt", self.source)
        self.assertIn("completedAt", self.source)

    def test_runner_consumes_provisioned_runtime(self) -> None:
        self.assertIn("PT_ACCEPTANCE_RUNTIME_MANIFEST", self.source)
        self.assertIn("load_runtime_manifest", self.source)
        self.assertIn(
            'APPROVED_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")',
            self.source,
        )

    def test_runner_dispatches_stream_resilience(self) -> None:
        self.assertIn('"stream-resilience": "agent-stream-resilience-e2e"', self.source)
        self.assertIn("parser.add_argument(", self.source)
        self.assertIn("runner.run_stream_resilience()", self.source)

    def test_runner_injects_transport_fault(self) -> None:
        self.assertIn("class TcpFaultProxy", self.source)
        self.assertIn("except socket.timeout:", self.source)
        self.assertIn("cut_station_transport", self.source)
        self.assertIn("restore_station_transport", self.source)
        self.assertIn("reconciling_visible", self.source)

    def test_runner_proves_identity_boundary_and_station_readback(self) -> None:
        self.assertIn("logout_during_active_turn", self.source)
        self.assertIn("auth_gate_isolated", self.source)
        self.assertIn("station_identity_boundary_readback", self.source)
        self.assertIn("station_replay_readback", self.source)

    def test_runner_uses_acceptance_harness(self) -> None:
        self.assertIn("__PT_ACCEPTANCE__", self.source)
        self.assertIn("agent", self.source)

    def test_runner_waits_for_harness(self) -> None:
        self.assertIn("__PT_ACCEPTANCE__", self.source)
        self.assertIn("Agent acceptance harness", self.source)
        self.assertIn("wait_until(", self.source)

    def test_runner_has_step_telemetry(self) -> None:
        self.assertIn("def step(", self.source)
        self.assertIn("durationMs", self.source)

    def test_no_fixed_sleep_in_runner(self) -> None:
        self.assertNotIn("time.sleep(", self.source)

    def test_runner_uses_selenium(self) -> None:
        self.assertIn("selenium", self.source)
        self.assertIn("webdriver.Remote", self.source)


class AgentHarnessStaticTest(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(HARNESS.is_file(), f"{HARNESS} must exist")
        self.source = HARNESS.read_text(encoding="utf-8")

    def test_harness_registers_agent_namespace(self) -> None:
        self.assertIn("registerAcceptanceHarness('agent'", self.source)

    def test_harness_exposes_login(self) -> None:
        self.assertIn("loginWithPassword", self.source)

    def test_harness_exposes_navigate_to_agent(self) -> None:
        self.assertIn("navigateToAgent", self.source)
        self.assertIn("EVENT.NAVIGATION_REQUESTED", self.source)
        self.assertIn("resource: 'sessions'", self.source)
        self.assertIn("getClientRects()", self.source)

    def test_harness_exposes_send_message(self) -> None:
        self.assertIn("sendMessage", self.source)
        self.assertIn("useChatStore", self.source)

    def test_harness_exposes_get_messages(self) -> None:
        self.assertIn("getMessages", self.source)

    def test_harness_exposes_wait_for_response(self) -> None:
        self.assertIn("waitForAssistantResponse", self.source)

    def test_provider_fixture_requires_station_model_and_readiness(self) -> None:
        ensure_provider = self.source.index("async ensureProvider")
        model_readback = self.source.index(
            "const availableModels = await api.listAvailableModels()",
            ensure_provider,
        )
        profile_update = self.source.index(
            "await agentStore.updateAgentProfile",
            ensure_provider,
        )
        readiness_readback = self.source.index(
            "await api.getAgentCapabilityReadiness",
            profile_update,
        )
        configured_result = self.source.index(
            "return { configured: true",
            readiness_readback,
        )

        self.assertLess(model_readback, profile_update)
        self.assertLess(profile_update, readiness_readback)
        self.assertLess(readiness_readback, configured_result)
        self.assertIn("model.provider_id === providerId", self.source)
        self.assertIn(
            "modelCapabilities.snapshot_id !== readiness.runtime_snapshot_id",
            self.source,
        )

    def test_harness_exposes_r6_production_actions_and_readback(self) -> None:
        for method in (
            "logout",
            "getRuntimeSnapshot",
            "getConversationReadback",
        ):
            with self.subTest(method=method):
                self.assertIn(method, self.source)

    def test_harness_exposes_foundation_group_one_actions(self) -> None:
        for method in (
            "getFoundationAgentState",
            "getFoundationCapabilitySessions",
            "uploadFoundationAttachmentBytes",
            "resolveFoundationAttachmentObject",
            "getFoundationAttachmentRuntimeReadiness",
            "captureFoundationRuntimeState",
            "setFoundationLocale",
            "createFoundationConversation",
            "selectFoundationConversation",
            "submitFoundationTurns",
            "updateFoundationConversation",
            "archiveFoundationConversation",
            "restoreFoundationConversation",
            "retryFoundationTurn",
            "regenerateFoundationTurn",
            "editAndResendFoundationMessage",
            "selectFoundationBranch",
            "getFoundationTurnEvidence",
            "submitFoundationFeedback",
            "stopFoundationTurn",
        ):
            with self.subTest(method=method):
                self.assertIn(method, self.source)

    def test_harness_drives_as_f05_through_production_boundaries(self) -> None:
        self.assertIn("cell === 'AS-F05'", self.source)
        self.assertIn("runFoundationF05Scenario", self.source)
        self.assertIn("api.ossUploadAgentAttachmentBytes", self.source)
        self.assertIn("api.ossResolveUrl", self.source)
        self.assertIn("api.ossDeleteAgentAttachment", self.source)
        self.assertIn("fetch(resolved.url, { cache: 'no-store' })", self.source)
        self.assertIn("attachment = { ...png }", self.source)
        self.assertIn(
            "evidenceField(record, 'objectRef', 'object_ref')",
            self.source,
        )
        self.assertNotIn(
            "authorization_scope: `conversation:${rejectedConversation.conversation_id}`",
            self.source,
        )
        self.assertIn("startObservedFoundationTurn", self.source)
        self.assertIn("foundationDiagnosticReplay", self.source)
        self.assertNotIn("mockFoundationAttachment", self.source)
        gateway = DESKTOP_HTTP_GATEWAY.read_text(encoding="utf-8")
        self.assertIn('"oss_upload_agent_attachment_bytes"', gateway)
        self.assertIn('"oss_resolve_url"', gateway)
        self.assertIn('"oss_delete_file"', gateway)

    def test_as_f04_budget_uses_browser_and_tauri_production_streams(self) -> None:
        desktop_api = DESKTOP_API.read_text(encoding="utf-8")
        contracts = DESKTOP_CONTRACTS.read_text(encoding="utf-8")
        agent_turn = DESKTOP_AGENT_TURN.read_text(encoding="utf-8")

        self.assertIn(
            "requested_budget?: AgentRuntimeBudgetInput",
            desktop_api,
        )
        self.assertIn(
            "body: JSON.stringify({ ...input, stream: true })",
            desktop_api,
        )
        self.assertIn(
            "pub requested_budget: Option<AgentRuntimeBudgetInput>",
            contracts,
        )
        self.assertIn(
            'body["requested_budget"] = json!(requested_budget)',
            agent_turn,
        )
        self.assertIn(
            "max_tool_calls: FOUNDATION_LOOP_MAX_TOOL_CALLS",
            self.source,
        )
        self.assertIn("FOUNDATION_LOOP_MAX_TOOL_CALLS = 2", self.source)
        self.assertIn("max_tool_calls_exhausted", self.source)

    def test_as_f06_uses_observed_identity_actions_and_durable_deltas(self) -> None:
        self.assertIn("authenticatedFoundationActorPtid", self.source)
        self.assertIn(
            "error.message), sourcePtid);",
            self.source,
        )
        self.assertIn("foundationDurableMutationSnapshot", self.source)
        self.assertIn("retryTurnRecovery(handoff.conversationId)", self.source)
        self.assertIn("reloadTurnSnapshot(handoff.conversationId)", self.source)
        self.assertIn(
            "AS_F06_ACTIVE_RECOVERY_FAILURE_NOT_OBSERVED",
            self.source,
        )
        self.assertNotIn("durableReloadReached: true", self.source)
        self.assertNotIn("duplicateDelta: 0", self.source)
        self.assertNotIn("`${handoff.turnId}-missing`", self.source)

    def test_harness_reuses_identity_runtime(self) -> None:
        self.assertIn("identityRuntime", self.source)
        self.assertIn("loginWithPassword", self.source)

    def test_harness_does_not_contain_secrets(self) -> None:
        self.assertNotIn("password =", self.source.replace("password }", ""))


class AgentCapabilitySessionStaticTest(unittest.TestCase):
    def test_browser_and_desktop_launchers_select_distinct_surfaces(self) -> None:
        browser_source = DESKTOP_WEB_SCRIPT.read_text(encoding="utf-8")
        self.assertIn(
            "PT_CLIENT_SURFACE=browser",
            browser_source,
        )
        self.assertIn("VITE_ACCEPTANCE_HARNESS=1", browser_source)
        self.assertIn("VITE_RUNTIME_EVIDENCE_HARNESS=1", browser_source)
        self.assertIn(
            "PT_CLIENT_SURFACE=desktop",
            DESKTOP_APP_SCRIPT.read_text(encoding="utf-8"),
        )

    def test_browser_supervisor_has_no_desktop_execution_capabilities(self) -> None:
        source = CAPABILITY_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("ClientSurface::Browser", source)
        self.assertIn("return Vec::new()", source)
        self.assertIn("if self.surface == ClientSurface::Browser", source)
        self.assertIn("(None, None, None)", source)

    def test_browser_session_is_opened_by_web_runtime_not_process_boot(self) -> None:
        runtime = AGENT_CAPABILITY_RUNTIME.read_text(encoding="utf-8")
        desktop_main = DESKTOP_MAIN.read_text(encoding="utf-8")
        self.assertIn("openBrowserCapabilitySession", runtime)
        self.assertIn("closeBrowserCapabilitySession", runtime)
        self.assertIn("starts_automatically()", desktop_main)

    def test_harness_compares_local_and_station_session_authorities(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        self.assertIn("getAgentCapabilitySessionSnapshot", source)
        self.assertIn("listAgentCapabilitySessions", source)
        self.assertIn("capability_session_id_hash", source)
        self.assertIn("selectedStationSession", source)
        self.assertIn("waitForCapabilitySessionEvidence", source)

    def test_queue_probe_requires_explicit_expected_capacity(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        self.assertIn("expectedQueueSize", source)
        self.assertIn("queueCapacitySnapshotMismatch", source)
        self.assertIn("receiverDomAtCapacity", source)

    def test_group_one_queue_probe_requires_completed_active_turn(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        self.assertIn("const queuedTurns = Array.from({ length: 8 }", source)
        self.assertIn("queuedTurns.map((queued) => queued.result)", source)
        self.assertIn("await api.cancelAgentTurn(activeTurnId)", source)
        self.assertIn("event.event === 'cancelled'", source)
        self.assertIn("preparedTurnId = activeTurnId", source)

    def test_group_one_controller_uses_manifest_bound_client_modes(self) -> None:
        source = FOUNDATION_RUNTIME_CLIENT.read_text(encoding="utf-8")
        self.assertIn('"native-tauri", "browser"', source)
        self.assertIn('"desktop" if self.runtime == "native-tauri" else "desktop-web"', source)
        self.assertIn("call_async_harness", source)
        self.assertIn("harness_ready", source)
        self.assertIn("os.killpg", source)
        self.assertIn("portsReleased", source)


class AgentSelectorsBoundInProductSource(unittest.TestCase):
    def test_composer_selector_bound(self) -> None:
        source = (ROOT / "apps/desktop/src/components/ChatInput.tsx").read_text(encoding="utf-8")
        self.assertIn("data-pt-agent-composer", source)
        self.assertIn("data-pt-agent-composer-send", source)
        self.assertIn("data-pt-agent-stop", source)

    def test_message_selectors_bound(self) -> None:
        assistant = (ROOT / "apps/desktop/src/components/messages/AssistantMessage.tsx").read_text(encoding="utf-8")
        self.assertIn("data-pt-agent-message=\"assistant\"", assistant)

        user = (ROOT / "apps/desktop/src/components/messages/UserMessage.tsx").read_text(encoding="utf-8")
        self.assertIn("data-pt-agent-message=\"user\"", user)

    def test_tool_approval_selectors_bound(self) -> None:
        source = (ROOT / "apps/desktop/src/components/messages/ToolCallCard.tsx").read_text(encoding="utf-8")
        self.assertIn("submitAgentToolDecision", source)
        self.assertIn("approval_required", source)
        self.assertIn("chat.message.toolCall.approve", source)

if __name__ == "__main__":
    unittest.main()
