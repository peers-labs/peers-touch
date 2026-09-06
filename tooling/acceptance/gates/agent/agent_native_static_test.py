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
DESKTOP_WEB_MAIN = ROOT / "apps" / "desktop" / "src" / "main.tsx"
DESKTOP_APP = ROOT / "apps" / "desktop" / "src" / "App.tsx"
IDENTITY_RUNTIME = (
    ROOT / "apps" / "desktop" / "src" / "kernel" / "identityRuntime.ts"
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
FOUNDATION_SCENARIO_RUNNER = (
    ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "agent"
    / "foundation_scenario_runner.py"
)
TCP_FAULT_PROXY = (
    ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "agent"
    / "tcp_fault_proxy.py"
)
DESKTOP_HTTP_GATEWAY = (
    ROOT / "apps" / "desktop" / "src-tauri" / "src" / "interface" / "http_gateway" / "mod.rs"
)
DESKTOP_API = ROOT / "apps" / "desktop" / "src" / "services" / "desktop_api.ts"
DESKTOP_APP_RUNTIME = (
    ROOT / "apps" / "desktop" / "src" / "services" / "appRuntime.ts"
)
DESKTOP_APP_RUNTIME_HOOK = (
    ROOT / "apps" / "desktop" / "src" / "hooks" / "useAppRuntime.ts"
)
DESKTOP_AGENT_TOPIC_RUNTIME = (
    ROOT / "apps" / "desktop" / "src" / "runtimes" / "agentTopicRuntime.ts"
)
DESKTOP_TOOL_RUNTIME = (
    ROOT / "apps" / "desktop" / "src" / "runtimes" / "toolRuntime.ts"
)
DESKTOP_CHAT_STORE = ROOT / "apps" / "desktop" / "src" / "store" / "chat.ts"
SHARED_AGENT_CHAT_CACHE = (
    ROOT / "packages" / "client-chat-core" / "src" / "agentChatCache.ts"
)
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
DESKTOP_AGENT_CRUD = (
    ROOT / "apps" / "desktop" / "src-tauri" / "src" / "application" / "agents" / "mod.rs"
)
DESKTOP_AGENT_COMMANDS = (
    ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "src"
    / "interface"
    / "tauri_commands"
    / "agents.rs"
)
DESKTOP_AUTH_SERVICE = (
    ROOT / "apps" / "desktop" / "src-tauri" / "src" / "application" / "auth" / "service.rs"
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
        proxy_source = TCP_FAULT_PROXY.read_text(encoding="utf-8")
        self.assertIn(
            "from tooling.acceptance.gates.agent.tcp_fault_proxy "
            "import TcpFaultProxy",
            self.source,
        )
        self.assertIn("class TcpFaultProxy", proxy_source)
        self.assertIn("except socket.timeout:", proxy_source)
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

    def test_acceptance_observers_install_before_app_render(self) -> None:
        main_source = DESKTOP_WEB_MAIN.read_text(encoding="utf-8")
        install_call = main_source.index(
            "await installAcceptanceHarnessesForBuild()"
        )
        render_call = main_source.index("createRoot(")

        self.assertLess(install_call, render_call)
        self.assertIn("await installAcceptanceHarnesses()", main_source)
        self.assertNotIn(
            "void import('./acceptance/registry')",
            main_source,
        )

    def test_replay_observer_accepts_primary_and_observation_deliveries(self) -> None:
        self.assertIn(
            "if (payload.event === 'replaying')",
            self.source,
        )
        self.assertIn("foundationF06ReplayingScenarios.add(", self.source)
        self.assertIn("if (!sourceDelivery) return;", self.source)
        self.assertNotIn(
            "observed.deliveryOnly !== true || !sourceDelivery",
            self.source,
        )

    def test_recovery_cursor_is_frozen_at_fault_acknowledgement(self) -> None:
        prepare_start = self.source.index(
            "async function prepareFoundationF06Conversation"
        )
        prepare_end = self.source.index(
            "async function observeFoundationRecoveryFailure",
            prepare_start,
        )
        requested_cursor = self.source.index(
            "const requestedCursor = active.cursor",
            prepare_start,
        )
        handoff_publish = self.source.index(
            "foundationF06PendingHandoffs.set(input.scenarioKey, handoff)",
            requested_cursor,
        )
        fault_request = self.source.index(
            "requestFoundationF06TransportCut(input.faultControlUrl)",
            handoff_publish,
        )
        fault_observation = self.source.index(
            "Foundation AS-F06 fault acknowledgement",
            fault_request,
        )
        cursor_capture = self.source.index(
            "const acknowledgedCursor = activeAtCut.cursor",
            fault_observation,
        )
        mutation_probe = self.source.index(
            "publishFault(duplicateSource, activeAtCut.streamGeneration)",
            cursor_capture,
        )
        boundary_publish = self.source.index(
            "resolveBoundary(boundary)",
            mutation_probe,
        )
        boundary_return = self.source.index(
            "return boundary.handoff",
            boundary_publish,
        )
        finalizer = self.source.index(
            "async function finalizeFoundationF06Preparation",
            boundary_return,
        )

        self.assertLess(requested_cursor, handoff_publish)
        self.assertLess(handoff_publish, fault_request)
        self.assertLess(fault_request, fault_observation)
        self.assertLess(fault_observation, cursor_capture)
        self.assertLess(cursor_capture, mutation_probe)
        self.assertLess(mutation_probe, boundary_publish)
        self.assertNotIn("await ", self.source[cursor_capture:mutation_probe])
        self.assertNotIn(
            "foundationRecoveryCursorAdvancedBeforeFault",
            self.source[prepare_start:prepare_end],
        )
        self.assertIn(
            "foundationRecoveryCursorAdvancedAfterFault",
            self.source[mutation_probe:boundary_publish],
        )
        self.assertIn(
            "]);\n  return boundary.handoff;",
            self.source[boundary_publish:boundary_return + len("return boundary.handoff;")],
        )
        self.assertIn(
            "transitions: []",
            self.source[requested_cursor:boundary_publish],
        )
        self.assertIn(
            "replayDeliveries: []",
            self.source[requested_cursor:boundary_publish],
        )
        self.assertNotIn(
            "controller.disconnectTransport()",
            self.source[prepare_start:finalizer],
        )
        self.assertIn(
            "foundationF06PendingHandoffs.delete(scenarioKey)",
            self.source[finalizer:prepare_end],
        )
        self.assertIn(
            "writeFoundationF06Handoff(handoff)",
            self.source[finalizer:prepare_end],
        )
        drain = self.source.index(
            "await foundationF06ReplayRecording",
            finalizer,
        )
        pending_delete = self.source.index(
            "foundationF06PendingHandoffs.delete(scenarioKey)",
            drain,
        )
        self.assertLess(drain, pending_delete)
        self.assertIn(
            "async foundationF06FinalizePreparation",
            self.source,
        )
        self.assertIn(
            "writeFoundationF06CleanupLocator",
            self.source[prepare_start:prepare_end],
        )
        self.assertIn(
            "foundationCleanupLocatorMissing",
            self.source,
        )
        self.assertIn(
            "state: 'deleted'",
            self.source,
        )
        self.assertIn(
            "removeFoundationF06Handoff(input.scenarioKey, false)",
            self.source,
        )
        cleanup_start = self.source.index(
            "async function cleanupFoundationF06Scenario",
        )
        cleanup_identity_check = self.source.index(
            "cleanupLocator.conversationId !== input.conversationId",
            cleanup_start,
        )
        deleted_receipt = self.source.index(
            "cleanupLocator?.state === 'deleted'",
            cleanup_start,
        )
        self.assertLess(cleanup_identity_check, deleted_receipt)

    def test_recovery_preparation_uses_one_fault_bound_attempt(self) -> None:
        prepare_start = self.source.index("async function runFoundationF06Prepare")
        prepare_end = self.source.index(
            "async function prepareFoundationF06Conversation",
            prepare_start,
        )
        observe_start = self.source.index(
            "async function observeFoundationRecoveryFailure",
            prepare_end,
        )
        observe_end = self.source.index(
            "async function exerciseFoundationDurableReload",
            observe_start,
        )

        self.assertNotIn(
            "maximumAttempts",
            self.source[prepare_start:prepare_end],
        )
        self.assertIn("preparationAttempts: 1", self.source[prepare_end:observe_start])
        self.assertIn("await cleanupFoundationF06Scenario", self.source)
        self.assertIn(
            "foundationF06Controllers.set(input.scenarioKey, observed.controller)",
            self.source[prepare_end:observe_start],
        )
        self.assertNotIn(
            "disconnectTransport()",
            self.source[observe_start:observe_end],
        )

    def test_recovery_completion_reads_failure_after_evidence_sync(self) -> None:
        completion_start = self.source.index(
            "async function runFoundationF06Complete",
        )
        completion_end = self.source.index(
            "interface DirectCellAssertionContext",
            completion_start,
        )
        completion = self.source[completion_start:completion_end]
        evidence_sync = completion.index("await foundationF06ReplayRecording")
        latest_handoff = completion.index(
            "const latestHandoff = readFoundationF06Handoff",
            evidence_sync,
        )
        recovery_failure = completion.index(
            "latestHandoff.recoveryFailure",
            latest_handoff,
        )

        self.assertLess(evidence_sync, latest_handoff)
        self.assertLess(latest_handoff, recovery_failure)
        self.assertNotIn(
            "handoff.recoveryFailure",
            completion[:evidence_sync],
        )
        replay_boundary = completion.index(
            "const replayStartTransition = latestHandoff.transitions.find",
            latest_handoff,
        )
        station_readback = completion.index(
            "const stationReplayDeliveries = await foundationStationReplayReadback",
            replay_boundary,
        )
        self.assertIn(
            "transition.phase === 'REPLAYING'",
            completion[replay_boundary:station_readback],
        )
        self.assertIn(
            "acknowledgedCursor: replayAfterCursor",
            completion[station_readback:],
        )
        self.assertIn("afterCursor: replayAfterCursor", completion[station_readback:])

    def test_revision_retry_cancels_after_durable_provider_start(self) -> None:
        scenario_start = self.source.index(
            "async function runFoundationF07Scenario",
        )
        scenario_end = self.source.index(
            "interface DirectCellAssertionContext",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("event.event !== 'progress'", scenario)
        self.assertIn(
            "event.data.stage !== 'provider_call_started'",
            scenario,
        )
        self.assertIn(
            "Reply with 20 short numbered items for retry sample",
            scenario,
        )
        self.assertNotIn(
            "100 short items",
            scenario,
        )
        self.assertNotIn("event.event !== 'text'", scenario)
        self.assertEqual(
            scenario.count("await resolveFoundationToolTurnSession()"),
            2,
        )
        self.assertNotIn("input.capabilitySessionId", scenario)
        self.assertIn(
            "sourceParentMessageId: String(sourceUser.parentMessageId ?? '')",
            scenario,
        )
        self.assertIn("stableJson(originalAttemptsBefore)", scenario)
        self.assertIn("stableJson(originalAttemptsAfter)", scenario)
        self.assertNotIn(
            "withoutDiagnosticGenerationTime(originalDiagnosticsBefore)",
            scenario,
        )

    def test_capability_contract_scenario_uses_production_controls(self) -> None:
        scenario_start = self.source.index(
            "async function runFoundationF10Scenario",
        )
        scenario_end = self.source.index(
            "interface DirectCellAssertionContext",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("withFoundationCapabilitiesDisabled(", scenario)
        self.assertIn("withFoundationReadyCapabilityFixture(", scenario)
        self.assertIn("runFoundationF10WithCapabilityIsolation", scenario)
        self.assertIn("const readiness = await api.getAgentCapabilityReadiness(", scenario)
        self.assertIn("    true,\n  );", scenario)
        self.assertIn("toolIsolation", scenario)
        self.assertIn("runAgentCapabilityNegativeControl(", scenario)
        for control in (
            "'unsupported'",
            "'unauthorized'",
            "'signatureTamper'",
            "'schemaMismatch'",
            "'crossDevice'",
        ):
            self.assertIn(control, scenario)
        self.assertIn("localAttemptDelta", scenario)
        self.assertIn("sideEffectDelta", scenario)
        self.assertIn("crossDeviceSession.session_id", scenario)

    def test_foundation_readiness_turn_disables_tool_bindings(self) -> None:
        direct_probe = self.source.index("async foundationDirectProbe")
        scenario_start = self.source.index(
            "if (cell === 'AS-F01')",
            direct_probe,
        )
        scenario_end = self.source.index(
            "if (cell === 'AS-F02')",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("withFoundationReadyCapabilityFixture(", scenario)
        self.assertIn("withFoundationCapabilitiesDisabled(", scenario)
        self.assertLess(
            scenario.index("withFoundationReadyCapabilityFixture("),
            scenario.index("withFoundationCapabilitiesDisabled("),
        )
        self.assertIn("thinkingMode: 'disabled'", scenario)
        self.assertIn("scenarioFacts = { toolIsolation }", scenario)
        self.assertIn("      true,", scenario)
        self.assertNotIn("streamAgentTurn({", scenario)

    def test_queue_scenario_waits_for_receiver_projection(self) -> None:
        direct_probe = self.source.index("async foundationDirectProbe")
        scenario_start = self.source.index(
            "if (cell === 'AS-F02')",
            direct_probe,
        )
        scenario_end = self.source.index(
            "if (cell === 'AS-F03')",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("'Foundation AS-F02 queue projection'", scenario)
        self.assertIn(
            "queueProjection.queuePositions.visibleCount",
            scenario,
        )
        self.assertLess(
            scenario.index("'Foundation AS-F02 queue projection'"),
            scenario.index("return foundationDomSnapshot();"),
        )

    def test_two_topic_restart_scenario_uses_production_authorities(self) -> None:
        snapshot_start = self.source.index(
            "async function foundationF12TopicSnapshot",
        )
        snapshot_end = self.source.index(
            "async function foundationF12ReceiverSnapshot",
            snapshot_start,
        )
        snapshot = self.source[snapshot_start:snapshot_end]
        prepare_start = self.source.index(
            "async function runFoundationF12Prepare",
        )
        complete_start = self.source.index(
            "async function runFoundationF12Complete",
            prepare_start,
        )
        prepare = self.source[prepare_start:complete_start]
        fixture_helper_start = self.source.index(
            "async function runFoundationF12PrepareWithCapabilityFixture",
            prepare_start,
        )
        fixture_helper_end = self.source.index(
            "async function traverseFoundationF12Branches",
            fixture_helper_start,
        )
        fixture_helper = self.source[fixture_helper_start:fixture_helper_end]
        complete_end = self.source.index(
            "async function foundationRevisionMessageFact",
            complete_start,
        )
        complete = self.source[complete_start:complete_end]

        self.assertIn("withFoundationCapabilitiesDisabled(", prepare)
        self.assertIn("withFoundationReadyCapabilityFixture(", fixture_helper)
        self.assertIn("runFoundationF12Prepare({", fixture_helper)
        self.assertIn(
            "runFoundationF12PrepareWithCapabilityFixture({",
            self.source,
        )
        self.assertIn("JSON.parse(stableJson(snapshot))", snapshot)
        self.assertIn("topicLabel: topic.key", snapshot)
        self.assertNotIn("key: topic.key", snapshot)
        self.assertIn("runFoundationF12Turn({", prepare)
        self.assertEqual(prepare.count("runFoundationF12Turn({"), 4)
        self.assertIn("await api.regenerateAgentTurn({", prepare)
        self.assertIn("await api.selectAgentActiveBranch({", prepare)
        self.assertIn("staleExpectedVersion", prepare)
        self.assertIn("foundationF12TopicSnapshot(", prepare)
        self.assertIn("foundationF12ReceiverSnapshot(", prepare)
        self.assertIn("writeFoundationF12Handoff(handoff)", prepare)
        self.assertIn("label: 'BetaOriginal'", prepare)
        self.assertIn(
            "selectedBranchMessageId: betaAssistant.messageId",
            prepare,
        )
        self.assertNotIn("label: 'BetaSibling'", prepare)
        self.assertIn("readFoundationF12Handoff(input.scenarioKey)", complete)
        self.assertIn("alphaPostRestartHash", complete)
        self.assertIn("betaPostRestartHash", complete)
        self.assertIn("traverseFoundationF12Branches(", complete)
        self.assertIn("alternatePostRestart", self.source)
        self.assertIn("restoredSelectedPostRestart", self.source)
        self.assertIn("stationRestarted:", complete)
        self.assertIn("clientRestarted:", complete)
        self.assertNotIn("noCrossTopicReferences: true", self.source)

        direct_probe = self.source.index("async foundationDirectProbe")
        f12 = self.source.index("if (cell === 'AS-F12')", direct_probe)
        next_cell = self.source.index("if (cell === 'AS-F05')", f12)
        f12_dispatch = self.source[f12:next_cell]
        self.assertIn("runFoundationF12Complete(stationRestart", f12_dispatch)
        self.assertNotIn("createAgentConversation", f12_dispatch)

    def test_two_topic_cleanup_deletes_both_topics_and_handoff(self) -> None:
        cleanup_start = self.source.index(
            "async function cleanupFoundationF12Scenario",
        )
        cleanup_end = self.source.index(
            "async function runFoundationF12Prepare",
            cleanup_start,
        )
        cleanup = self.source[cleanup_start:cleanup_end]

        self.assertIn("for (const conversationId of", cleanup)
        self.assertIn("await deleteFoundationConversation(conversationId)", cleanup)
        self.assertIn("removeFoundationF12Handoff(input.scenarioKey)", cleanup)
        self.assertIn("deletedConversationIds.length === conversationIds.length", cleanup)

    def test_agent_topic_reconciliation_refreshes_authoritative_branch_projection(
        self,
    ) -> None:
        cache_source = SHARED_AGENT_CHAT_CACHE.read_text(encoding="utf-8")
        chat_source = DESKTOP_CHAT_STORE.read_text(encoding="utf-8")
        runtime_source = DESKTOP_AGENT_TOPIC_RUNTIME.read_text(encoding="utf-8")
        tool_runtime_source = DESKTOP_TOOL_RUNTIME.read_text(encoding="utf-8")
        sync_start = chat_source.index("syncMessages: async () =>")
        sync_end = chat_source.index("applyRecoveredTurnEvent:", sync_start)
        sync_messages = chat_source[sync_start:sync_end]

        self.assertIn("refreshConversation(conversationId", cache_source)
        self.assertIn("replaceMessages(conversationId, messages)", cache_source)
        self.assertIn(
            "agentChatCache.refreshConversation(currentSessionKey)",
            sync_messages,
        )
        self.assertNotIn(
            "agentChatCache.syncConversation(currentSessionKey)",
            sync_messages,
        )
        self.assertIn(
            "toolRuntime.reconcileMessages(folded)",
            chat_source,
        )
        self.assertIn(
            "reconcileToolProjectionState(this.state, reconciled)",
            tool_runtime_source,
        )
        self.assertIn(
            "api.exportAgentTurnDiagnostics(turnId)",
            tool_runtime_source,
        )
        self.assertEqual(
            runtime_source.count(
                "await useChatStore.getState().syncMessages();",
            ),
            2,
        )

    def test_denial_evidence_distinguishes_policy_and_user_denial(self) -> None:
        helper_start = self.source.index("function diagnosticToolCase")
        helper_end = self.source.index(
            "async function foundationToolSideEffectCount",
            helper_start,
        )
        helper = self.source[helper_start:helper_end]

        deny_policy_branch = helper.index("else if (policy === 'deny')")
        manual_wait_state = helper.index("states.push('awaiting_user')")
        self.assertLess(deny_policy_branch, manual_wait_state)
        self.assertIn("states.push('denied')", helper)
        self.assertIn("states.push('awaiting_user')", helper)
        self.assertIn(
            "states.push(approved ? 'approved' : 'denied')",
            helper,
        )
        self.assertNotIn("if (status === 'denied')", helper)

    def test_revision_scenario_disables_capabilities_and_restores_them(self) -> None:
        revision_start = self.source.index(
            "async function runFoundationF07Scenario",
        )
        revision_end = self.source.index(
            "function foundationF10RejectionFact",
            revision_start,
        )
        revision = self.source[revision_start:revision_end]
        self.assertIn("sourceCancellationStatus", revision)
        self.assertIn("sourceStreamCancellationObserved", revision)
        self.assertNotIn(
            "if (!retrySourceResult.events.some",
            revision,
        )
        self.assertEqual(revision.count(".branchFromMessage("), 1)
        self.assertNotIn("label: 'F07Selected'", revision)
        self.assertIn(
            "await api.getAgentConversation(conversation.conversation_id)",
            revision,
        )

        helper_start = self.source.index(
            "async function runFoundationF07WithCapabilityIsolation",
        )
        helper_end = self.source.index(
            "function evaluateF01",
            helper_start,
        )
        helper = self.source[helper_start:helper_end]
        self.assertIn("withFoundationReadyCapabilityFixture(", helper)
        self.assertIn("await resolveFoundationToolTurnSession()", helper)
        self.assertIn("withFoundationCapabilitiesDisabled(", helper)
        self.assertIn("      true,", helper)

        fixture_start = self.source.index(
            "async function prepareFoundationReadyCapabilityFixture",
        )
        fixture_end = self.source.index(
            "async function startFoundationToolTurn",
            fixture_start,
        )
        fixture = self.source[fixture_start:fixture_end]
        self.assertIn("foundationToolFixture(agentId, platform)", fixture)
        self.assertIn("CapabilityApprovalPolicy.MANUAL", fixture)
        self.assertIn(
            "setupIdempotencyKey: crypto.randomUUID()",
            fixture,
        )
        self.assertIn("parseFoundationCapabilityFixtureJournal(", fixture)
        self.assertIn("await prepareFoundationCapabilityFixture(journal)", fixture)
        self.assertIn(
            "await restorePersistedFoundationCapabilityIsolation()",
            fixture,
        )
        self.assertIn(
            "await restorePersistedFoundationCapabilityFixture()",
            fixture,
        )
        self.assertIn("cleanupExpectedRevision", self.source)
        self.assertIn("cleanupIdempotencyKey", self.source)
        self.assertIn(
            "BigInt(cleanupExpectedRevision), cleanupIdempotencyKey",
            self.source,
        )

        direct_probe = self.source.index("async foundationDirectProbe")
        scenario_start = self.source.index(
            "if (cell === 'AS-F07')",
            direct_probe,
        )
        scenario_end = self.source.index(
            "capabilitySessions = await waitForCapabilitySessionEvidence()",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("runFoundationF07WithCapabilityIsolation({", scenario)
        self.assertIn(
            "restorePersistedFoundationCapabilityIsolation",
            self.source,
        )
        self.assertIn(
            "FOUNDATION_CAPABILITY_ISOLATION_STORAGE_KEY",
            self.source,
        )
        self.assertIn("restorationVerified", self.source)
        isolation_start = self.source.index(
            "async function withFoundationCapabilitiesDisabled",
        )
        isolation_end = self.source.index(
            "async function startFoundationToolTurn",
            isolation_start,
        )
        isolation = self.source[isolation_start:isolation_end]
        self.assertLess(
            isolation.index(
                "await restorePersistedFoundationCapabilityIsolation()",
            ),
            isolation.index("window.localStorage.setItem("),
        )
        self.assertLess(
            isolation.index("const authoritativeAgent = await api.getAgent(agentId)"),
            isolation.index("window.localStorage.setItem("),
        )
        self.assertLess(
            isolation.index(
                "assertFoundationCapabilityIsolationPrerequisites(",
            ),
            isolation.index("window.localStorage.setItem("),
        )
        self.assertLess(
            isolation.index(
                "parseFoundationCapabilityIsolationJournal(serializedJournal)",
            ),
            isolation.index("window.localStorage.setItem("),
        )
        self.assertIn(
            "updateFoundationCapabilityBindingEnabled(\n"
            "        authoritativeAgent,",
            isolation,
        )

        runner = FOUNDATION_SCENARIO_RUNNER.read_text(encoding="utf-8")
        self.assertIn(
            '"restoreFoundationCapabilityIsolation"',
            runner,
        )
        self.assertIn(
            "remove_storage=not restoration_errors",
            runner,
        )
        self.assertIn(
            "CLEANUP_FAILED: {cleanup_kind} failed",
            runner,
        )
        self.assertIn(
            'required = result.get("restorationRequired")',
            runner,
        )
        self.assertIn(
            "if not isinstance(required, bool):",
            runner,
        )
        self.assertIn(
            "planFoundationCapabilityBindingRestoration(",
            self.source,
        )
        restore_start = self.source.index(
            "async function restorePersistedFoundationCapabilityIsolation",
        )
        restore_end = self.source.index(
            "function readFoundationCapabilityFixtureJournal",
            restore_start,
        )
        restore = self.source[restore_start:restore_end]
        self.assertLess(
            restore.index("await restoreFoundationCapabilityBindings("),
            restore.index("await api.upsertAgentCapabilityBinding("),
        )
        self.assertIn(
            "const currentBindings = "
            "await api.listAgentCapabilityBindings(journal.agentId)",
            restore,
        )
        self.assertIn(
            "planFoundationCapabilityBindingRestoration(",
            restore,
        )
        self.assertEqual(restore.count("await api.getAgent(journal.agentId)"), 2)
        self.assertLess(
            restore.rindex("await api.getAgent(journal.agentId)"),
            restore.index(
                "window.localStorage.removeItem("
                "FOUNDATION_CAPABILITY_ISOLATION_STORAGE_KEY"
            ),
        )
        self.assertIn(
            "isFoundationCapabilityIsolationRestored(toolIsolation)",
            self.source,
        )
        self.assertNotIn(
            "Number(toolIsolation.disabledBindingCount)",
            self.source,
        )

    def test_harness_exposes_login(self) -> None:
        self.assertIn("loginWithPassword", self.source)
        login_start = self.source.index("async loginWithPassword")
        login_end = self.source.index("async logout()", login_start)
        login = self.source[login_start:login_end]

        self.assertLess(
            login.index("identityRuntime.boot()"),
            login.index("'identity login precondition'"),
        )
        self.assertIn(
            "if (useSessionStore.getState().authenticated)",
            login,
        )
        self.assertIn("await identityRuntime.logout()", login)
        self.assertLess(
            login.index("'identity login precondition'"),
            login.index("'identity account gate before login'"),
        )

    def test_cleanup_logout_closes_identity_phase_before_session_reset(
        self,
    ) -> None:
        identity_runtime = IDENTITY_RUNTIME.read_text(encoding="utf-8")
        logout_start = identity_runtime.index("logout = async ()")
        logout_end = identity_runtime.index(
            "revalidateIfNeeded =",
            logout_start,
        )
        logout = identity_runtime[logout_start:logout_end]

        self.assertLess(
            logout.index("this.dispatch({ type: 'LOGOUT_REQUESTED' })"),
            logout.index("await useSessionStore.getState().logout()"),
        )
        self.assertLess(
            logout.index("await useSessionStore.getState().logout()"),
            logout.index("await this.loadAuthGate('logout', false)"),
        )
        self.assertIn("await identityRuntime.logout()", self.source)
        self.assertNotIn(
            "await useSessionStore.getState().logout()",
            self.source,
        )

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

    def test_agent_crud_uses_authenticated_station_authority(self) -> None:
        application = DESKTOP_AGENT_CRUD.read_text(encoding="utf-8")
        commands = DESKTOP_AGENT_COMMANDS.read_text(encoding="utf-8")

        for endpoint in (
            '"/sub-agent/agent/list"',
            '"/sub-agent/agent/get"',
            '"/sub-agent/agent/create"',
            '"/sub-agent/agent/update"',
            '"/sub-agent/agent/delete"',
        ):
            with self.subTest(endpoint=endpoint):
                self.assertIn(endpoint, application)

        self.assertIn("fn token_for_cmd", commands)
        self.assertIn("agents_list(&actor_ptid, &token)", commands)
        self.assertIn("agents_update(&actor_ptid, &token, input)", commands)
        self.assertNotIn('agents_list("")', commands)

    def test_browser_auth_binds_gateway_session_before_agent_commands(self) -> None:
        gateway = DESKTOP_HTTP_GATEWAY.read_text(encoding="utf-8")
        auth_service = DESKTOP_AUTH_SERVICE.read_text(encoding="utf-8")

        self.assertIn(
            "bind_gateway_auth_result(state, app_auth::auth_login(input, state))",
            gateway,
        )
        self.assertIn(
            "bind_gateway_auth_result(state, app_auth::access_submit_login(input, state))",
            gateway,
        )
        self.assertIn(
            'app_auth::auth_restore_session_for_device(state, "desktop-browser")',
            gateway,
        )
        self.assertIn('input.device_type = Some("desktop-browser".to_string())', gateway)
        self.assertIn("state.sessions.unbind(HTTP_GATEWAY_SESSION_LABEL)", gateway)
        self.assertIn('.unwrap_or("desktop-native")', auth_service)
        self.assertIn(
            'auth_restore_session_for_device(state, "desktop-native")',
            auth_service,
        )
        self.assertNotIn('"device_type": "desktop"', auth_service)

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

    def test_active_mutation_conflict_uses_production_profile_and_recovery(self) -> None:
        scenario_start = self.source.index(
            "async function runFoundationActiveMutationConflictScenario"
        )
        scenario_end = self.source.index(
            "async function buildDirectRuntimeAttestation",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("store.createAgent(", scenario)
        self.assertIn("api.updateAgent(disposable.id", scenario)
        self.assertIn("updateAgentProfile(disposable.id", scenario)
        self.assertIn("[data-pt-agent-profile-conflict]", scenario)
        self.assertIn("[data-pt-agent-profile-reload]", scenario)
        self.assertIn("reloadElement.click()", scenario)
        self.assertIn("await api.getAgent(disposable.id)", scenario)
        self.assertIn("await api.deleteAgent(disposable.id)", scenario)
        self.assertIn("await api.setSelectedAgent(priorSelection)", scenario)
        self.assertNotIn("mock", scenario.lower())

    def test_approval_denied_uses_product_action_and_station_readback(self) -> None:
        scenario_start = self.source.index(
            "async function runFoundationApprovalDeniedScenario"
        )
        scenario_end = self.source.index(
            "async function runFoundationApprovalExpiredScenario",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("CapabilityApprovalPolicy.MANUAL", scenario)
        self.assertIn("waitForToolApprovalEvent(turn)", scenario)
        self.assertIn(
            'data-pt-agent-tool-recovery="continue-without-tool"',
            scenario,
        )
        self.assertIn("recovery.click()", scenario)
        self.assertIn("waitForFoundationToolFacts(", scenario)
        self.assertIn("foundationToolSideEffectCount(", scenario)
        self.assertIn("api.submitAgentToolDecision({", scenario)
        self.assertNotIn("mock", scenario.lower())

    def test_approval_expired_uses_station_expiry_and_retry_action(self) -> None:
        self.assertNotIn("BASE-APPROVAL-EXPIRED", self.source)
        scenario_start = self.source.index(
            "async function runFoundationApprovalExpiredScenario"
        )
        scenario_end = self.source.index(
            "const FOUNDATION_PNG_BYTES",
            scenario_start,
        )
        scenario = self.source[scenario_start:scenario_end]

        self.assertIn("CapabilityApprovalPolicy.MANUAL", scenario)
        self.assertIn("waitForToolApprovalEvent(turn)", scenario)
        self.assertIn("ToolCallStatus.EXPIRED", scenario)
        self.assertIn(
            'data-pt-agent-tool-recovery="request-again"',
            scenario,
        )
        self.assertEqual(
            scenario.count("api.submitAgentToolDecision(\n      decisionIntent"),
            2,
        )
        self.assertEqual(scenario.count("recovery.click()"), 2)
        self.assertIn("api.cancelAgentTurn(turn.turnId)", scenario)
        self.assertEqual(
            scenario.count("foundationToolSideEffectCount("),
            3,
        )
        self.assertIn("retryToolStatus: toolStatusName(retryAfter.status)", scenario)
        for counter in (
            "retryExecutionAttemptCount",
            "retrySideEffectCount",
            "retryResultCount",
            "retryContinuationCount",
        ):
            with self.subTest(counter=counter):
                self.assertIn(counter, scenario)
        self.assertNotIn(
            "await useChatStore.getState().syncMessages()",
            scenario,
        )
        self.assertIn("foundationToolExpiryCleanupFailed", scenario)
        self.assertIn("cleanupFoundationToolConversation(", scenario)
        self.assertIn("cell === 'BASE-APPROVAL_EXPIRED'", self.source)
        self.assertIn(
            "|| cell === 'BASE-APPROVAL_EXPIRED'\n"
            "          ? 900_000",
            self.source,
        )
        self.assertNotIn("mock", scenario.lower())

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

    def test_cancel_turn_preserves_station_terminal_status(self) -> None:
        agent_turn = DESKTOP_AGENT_TURN.read_text(encoding="utf-8")

        self.assertIn(
            'Ok(result) => success_payload("agent_cancel_turn", result)',
            agent_turn,
        )
        self.assertNotIn(
            'json!({ "turn_id": turn_id, "status": "cancelling" })',
            agent_turn,
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

    def test_browser_gateway_exposes_runtime_evidence_commands(self) -> None:
        gateway = DESKTOP_HTTP_GATEWAY.read_text(encoding="utf-8")
        for command in (
            "agent_submit_feedback",
            "agent_list_turn_feedback",
            "agent_capability_sessions",
            "agent_browser_capability_session_open",
            "agent_browser_capability_session_close",
            "agent_runtime_activity_station",
            "agent_runtime_activity_local",
            "agent_capability_session_snapshot",
        ):
            with self.subTest(command=command):
                self.assertIn(f'"{command}" =>', gateway)
        self.assertIn(
            "app_runtime_evidence::open_browser_capability_session",
            gateway,
        )
        self.assertIn(
            "app_runtime_evidence::close_browser_capability_session",
            gateway,
        )
        self.assertIn(
            "app_runtime_evidence::capability_session_snapshot",
            gateway,
        )
        self.assertIn(
            "app_runtime_evidence::capability_negative_control",
            gateway,
        )
        self.assertIn("app_agent_growth::agent_submit_feedback", gateway)
        self.assertIn("app_agent_growth::agent_list_turn_feedback", gateway)

    def test_native_feedback_commands_are_registered(self) -> None:
        desktop_main = DESKTOP_MAIN.read_text(encoding="utf-8")

        self.assertIn("agent_growth::agent_submit_feedback", desktop_main)
        self.assertIn("agent_growth::agent_list_turn_feedback", desktop_main)

    def test_harness_compares_local_and_station_session_authorities(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        self.assertIn("getAgentCapabilitySessionSnapshot", source)
        self.assertIn("listAgentCapabilitySessions", source)
        self.assertIn("capability_session_id_hash", source)
        self.assertIn("selectedLocalSession", source)
        self.assertIn("selectedStationSession", source)
        self.assertIn("waitForCapabilitySessionEvidence", source)

    def test_foundation_f04_resolves_matched_session_before_each_turn(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        start = source.index("async function runFoundationF04Scenario")
        end = source.index(
            "async function runFoundationApprovalDeniedScenario",
            start,
        )
        scenario = source[start:end]
        run_case_start = scenario.index("const runCase")
        loop_start = scenario.index(
            "const loopCapabilitySession = await resolveFoundationToolTurnSession()"
        )
        run_case = scenario[run_case_start:loop_start]

        self.assertLess(
            run_case.index(
                "const capabilitySession = await resolveFoundationToolTurnSession()"
            ),
            run_case.index("const turn = await startFoundationToolTurn"),
        )
        self.assertIn(
            "capabilitySessionId: capabilitySession.capabilitySessionId",
            run_case,
        )
        for label in ("'auto'", "'manual'", "'deny'", "'expiry'"):
            self.assertIn(label, scenario)
        self.assertIn(
            "reportFoundationF04ExpirySettlementDebug(",
            run_case,
        )
        self.assertIn("'settlement-timeout'", run_case)
        self.assertIn("toolFactCount: facts.length", run_case)
        self.assertIn("toolStatuses: facts.map", run_case)
        self.assertIn("replayTerminal: diagnosticReplayTerminal(replay)", run_case)
        self.assertLess(
            loop_start,
            scenario.index("const loopTurn = await startFoundationToolTurn"),
        )
        self.assertIn(
            "capabilitySessionId: loopCapabilitySession.capabilitySessionId",
            scenario,
        )
        self.assertEqual(
            scenario.count("await resolveFoundationToolTurnSession()"),
            2,
        )
        self.assertNotIn("input.capabilitySessionId", scenario)
        self.assertIn("caseFact.capabilitySession = {", scenario)
        self.assertIn("...capabilitySession.facts", scenario)
        self.assertIn("...loopCapabilitySession.facts", scenario)
        self.assertIn("turnId: turn.turnId", scenario)
        self.assertIn("turnId: loopTurn.turnId", scenario)

        resolver_start = source.index(
            "async function resolveFoundationToolTurnSession"
        )
        resolver_end = source.index(
            "function withoutDiagnosticGenerationTime",
            resolver_start,
        )
        resolver = source[resolver_start:resolver_end]
        self.assertIn(
            "const capabilitySessions = await capabilitySessionEvidence()",
            resolver,
        )
        self.assertEqual(resolver.count("capabilitySessionEvidence()"), 1)
        self.assertNotIn("waitForCapabilitySessionEvidence", resolver)
        resolver_facts = resolver[resolver.index("facts: {"):]
        for hashed_identity in (
            "sessionIdHash: localSession.capability_session_id_hash",
            "actorIdHash: localSession.actor_id_hash",
            "deviceIdHash: localSession.device_id_hash",
        ):
            self.assertEqual(resolver_facts.count(hashed_identity), 1)
        for hashed_identity_key in (
            "sessionIdHash:",
            "actorIdHash:",
            "deviceIdHash:",
        ):
            self.assertEqual(resolver_facts.count(hashed_identity_key), 1)
        self.assertNotIn("sessionId:", resolver_facts)
        self.assertNotIn("capabilitySessionId:", resolver_facts)
        self.assertNotIn("actorId:", resolver_facts)
        self.assertNotIn("deviceId:", resolver_facts)
        self.assertNotIn("stationSession.session_id", resolver_facts)
        self.assertNotIn("stationSession.ptid", resolver_facts)
        self.assertNotIn("stationSession.device_id", resolver_facts)

        direct_probe_start = source.index("async foundationDirectProbe")
        direct_probe_end = source.index(
            "async foundationNonAdvertisementProbe",
            direct_probe_start,
        )
        direct_probe = source[direct_probe_start:direct_probe_end]
        self.assertIn(
            "let capabilitySessions = await waitForCapabilitySessionEvidence()",
            direct_probe,
        )
        self.assertEqual(
            direct_probe.count(
                "let capabilitySessions = await waitForCapabilitySessionEvidence()"
            ),
            1,
        )
        self.assertEqual(
            direct_probe.count(
                "\n      capabilitySessions = await waitForCapabilitySessionEvidence()"
            ),
            1,
        )
        self.assertLess(
            direct_probe.rindex(
                "capabilitySessions = await waitForCapabilitySessionEvidence()"
            ),
            direct_probe.index("const [profile, readiness, conversations]"),
        )

    def test_foundation_f04_approval_wait_fails_on_terminal_event(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        terminal_start = source.index("function firstToolApprovalOutcome")
        wait_start = source.index("async function waitForToolApprovalEvent")
        wait_end = source.index(
            "async function resolveFoundationToolTurnSession",
            wait_start,
        )
        outcome_helper = source[terminal_start:wait_start]
        approval_wait = source[wait_start:wait_end]

        self.assertEqual(outcome_helper.count("observed.events.find"), 1)
        self.assertIn(
            "candidate.event === 'tool_approval_required'",
            outcome_helper,
        )
        self.assertIn("['error', 'cancelled', 'done']", outcome_helper)
        self.assertNotIn(".find(", approval_wait)
        self.assertNotIn("toolApprovalEvent", approval_wait)
        self.assertNotIn("toolApprovalTerminalEvent", approval_wait)
        self.assertIn(
            "const outcome = firstToolApprovalOutcome(turn.observed)",
            approval_wait,
        )
        self.assertLess(
            approval_wait.index("outcome?.event === 'tool_approval_required'"),
            approval_wait.index("if (outcome)"),
        )
        self.assertIn(
            "agent.acceptance.foundationToolApprovalTerminated",
            approval_wait,
        )
        self.assertIn(
            "const terminalStage = String(outcome.data.stage ?? outcome.event)",
            approval_wait,
        )
        self.assertIn("stage=${terminalStage}", approval_wait)
        self.assertIn(
            "error=${error === null ? 'none' : stableJson(error)}",
            approval_wait,
        )
        self.assertLess(
            approval_wait.index("if (outcome)"),
            approval_wait.index("setTimeout(resolve, 50)"),
        )

    def test_queue_probe_requires_explicit_expected_capacity(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        self.assertIn("expectedQueueSize", source)
        self.assertIn("queueCapacitySnapshotMismatch", source)
        self.assertIn("receiverDomAtCapacity", source)

    def test_group_one_queue_probe_holds_active_turn_before_capacity_observation(
        self,
    ) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        start = source.index("if (cell === 'AS-F02')")
        end = source.index("if (cell === 'AS-F03')", start)
        scenario = source[start:end]

        ready_fixture = scenario.index(
            "await prepareFoundationReadyCapabilityFixture(",
        )
        queue_baseline = scenario.index(
            "const queueBeforeAdmissions = await api.listAgentTurnQueue(",
        )
        active_start = scenario.index(
            "const active = startObservedFoundationTurn({",
        )
        active_admission = scenario.index(
            "const activeAdmissionDeadline = Date.now() + 10_000;",
        )
        duplicate_start = scenario.index(
            "const duplicate = startObservedFoundationTurn({",
        )
        queue_start = scenario.index(
            "const queuedTurns = Array.from({ length: 8 }",
        )
        duplicate_first_event = scenario.index(
            "const duplicateFirstEvent = await duplicate.firstEvent;",
        )
        approval_wait = scenario.index(
            "await waitForToolApprovalEvent({",
        )
        capacity_snapshot = scenario.index(
            "const queueSnapshotStartedAt = performance.now();",
        )
        overflow_start = scenario.index(
            "const overflow = startObservedFoundationTurn({",
        )
        parallel_cancellation = scenario.index(
            "[cancellation, activeCancellation] = await Promise.all([",
        )
        single_queue_cancellation = scenario.index(
            "cancelFoundationQueuedTurns(\n"
            "              conversation.conversation_id,\n"
            "              1,",
            parallel_cancellation,
        )
        active_cancellation = scenario.index(
            "api.cancelAgentTurn(activeTurnId),",
            parallel_cancellation,
        )
        remaining_queue_cleanup = scenario.index(
            "await cancelFoundationQueuedTurns(conversation.conversation_id);",
            active_cancellation,
        )
        stream_completion = scenario.index(
            "firstActiveEvent,\n          activeResult,",
        )
        post_stream_queue_cleanup = scenario.index(
            "await cancelFoundationQueuedTurns(conversation.conversation_id);",
            stream_completion,
        )
        residual_turn_settlement = scenario.index(
            "const residualTurnIds = Array.from(new Set(",
            post_stream_queue_cleanup,
        )
        later_conversation_readback = scenario.index(
            "const afterQueue = await api.getAgentConversation(",
            residual_turn_settlement,
        )
        fixture_restore = scenario.index(
            "await restorePersistedFoundationCapabilityFixture();",
            later_conversation_readback,
        )

        self.assertLess(ready_fixture, queue_baseline)
        self.assertLess(queue_baseline, active_start)
        self.assertLess(active_start, active_admission)
        self.assertLess(active_admission, duplicate_start)
        self.assertLess(duplicate_start, queue_start)
        self.assertLess(queue_start, duplicate_first_event)
        self.assertLess(duplicate_first_event, approval_wait)
        self.assertLess(approval_wait, capacity_snapshot)
        self.assertLess(capacity_snapshot, overflow_start)
        self.assertLess(overflow_start, parallel_cancellation)
        self.assertLess(parallel_cancellation, single_queue_cancellation)
        self.assertLess(parallel_cancellation, active_cancellation)
        self.assertLess(active_cancellation, remaining_queue_cleanup)
        self.assertLess(remaining_queue_cleanup, stream_completion)
        self.assertLess(stream_completion, post_stream_queue_cleanup)
        self.assertLess(post_stream_queue_cleanup, residual_turn_settlement)
        self.assertLess(residual_turn_settlement, later_conversation_readback)
        self.assertLess(later_conversation_readback, fixture_restore)
        self.assertNotIn(
            "const duplicateResult = await duplicate.result;",
            scenario,
        )

    def test_group_one_queue_probe_requires_completed_active_turn(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        self.assertIn("const queuedTurns = Array.from({ length: 8 }", source)
        self.assertIn("queuedTurns.map((queued) => queued.result)", source)
        self.assertIn("api.cancelAgentTurn(activeTurnId),", source)
        self.assertIn("event.event === 'cancelled'", source)
        self.assertIn("preparedTurnId = activeTurnId", source)

    def test_group_one_progressive_cancel_starts_in_text_callback(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        start = source.index("if (cell === 'AS-F03')")
        end = source.index("if (cell === 'AS-F04')", start)
        scenario = source[start:end]

        self.assertIn("onEvent: (event, events)", scenario)
        self.assertIn("event.event !== 'text'", scenario)
        self.assertIn("api.cancelAgentTurn(turnId)", scenario)
        self.assertIn("resolveCancellation({ turnId, result })", scenario)
        self.assertIn("const maxCancellationAttempts = 2", scenario)
        self.assertIn("max_output_tokens: 4096", scenario)
        self.assertIn("timeoutMs: 90_000", scenario)
        self.assertIn("cancellationStatus === 'completed'", scenario)
        self.assertIn(
            "'agent.acceptance.foundationCancellationWindowUnavailable'",
            scenario,
        )
        self.assertLess(
            scenario.index(
                "await deleteFoundationConversation(conversation.conversation_id)",
            ),
            scenario.index("'cancel-window-retry'"),
        )
        self.assertIn("toLowerCase() !== 'cancelled'", scenario)
        self.assertIn("terminalEvent?.eventType !== 'cancelled'", scenario)
        self.assertIn("!replay.deliveryOnly", source)
        self.assertIn("replay.streamGeneration !== controller.streamGeneration", source)
        self.assertNotIn("setTimeout(resolve, 50)", scenario)
        self.assertNotIn("disconnectTransport()", scenario)

    def test_as_f06_waits_for_an_acknowledged_text_prefix(self) -> None:
        source = HARNESS.read_text(encoding="utf-8")
        start = source.index("const textEvents = durableEvents.filter")
        end = source.index("const chatBefore =", start)
        prefix_boundary = source[start:end]

        self.assertIn("Number(candidate.data.seq ?? 0) <= acknowledgedCursor", prefix_boundary)
        self.assertIn("if (textEvents.length === 0)", prefix_boundary)
        self.assertIn("'prefix-not-acknowledged'", prefix_boundary)
        self.assertLess(
            prefix_boundary.index("if (textEvents.length === 0)"),
            prefix_boundary.index("if (!prefix)"),
        )

    def test_agent_chat_runtime_bootstraps_before_authenticated_turns(self) -> None:
        app_runtime = DESKTOP_APP_RUNTIME.read_text(encoding="utf-8")
        runtime_hook = DESKTOP_APP_RUNTIME_HOOK.read_text(encoding="utf-8")
        app = DESKTOP_APP.read_text(encoding="utf-8")
        harness = HARNESS.read_text(encoding="utf-8")

        self.assertIn("CRITICAL_SESSION_RUNTIME_IDS", app_runtime)
        self.assertIn("chatRuntime.id", app_runtime)
        self.assertIn("await bootstrapRuntime(runtimeId, actorId)", app_runtime)
        self.assertIn("criticalInstallInFlight?.actorId === actorId", app_runtime)
        self.assertIn(
            "await installAuthenticatedCriticalRuntimes(user.actorPtid)",
            harness,
        )
        self.assertIn("tearDownSessionRuntimes()", runtime_hook)
        self.assertIn(
            "installIdleRuntimes(actorPtid, CRITICAL_SESSION_RUNTIME_IDS)",
            runtime_hook,
        )
        self.assertIn(
            "lifecycle.state === 'ready' && !criticalRuntimeReady",
            app,
        )

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
        assistant = (
            ROOT / "apps/desktop/src/components/messages/AssistantMessage.tsx"
        ).read_text(encoding="utf-8")
        detail = (
            ROOT / "apps/desktop/src/components/portal/views/ToolDetailView.tsx"
        ).read_text(encoding="utf-8")
        chat_store = (
            ROOT / "apps/desktop/src/store/chat.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("submitAgentToolDecision", source)
        self.assertIn("approval_required", source)
        self.assertIn("chat.message.toolCall.approve", source)
        self.assertIn("toolRuntime.getSnapshot", source)
        self.assertIn("useState(actionableToolState)", source)
        self.assertIn("if (actionableToolState) setExpanded(true)", source)
        approve_decision = source.index("submitAgentToolDecision(tool.id, true)")
        recovery_selector = source.index(
            'data-pt-agent-tool-recovery="continue-without-tool"'
        )
        deny_decision = source.index("submitAgentToolDecision(tool.id, false)")
        self.assertLess(approve_decision, recovery_selector)
        self.assertLess(recovery_selector, deny_decision)
        request_again = source.index(
            'data-pt-agent-tool-recovery="request-again"'
        )
        self.assertIn("void onRequestAgain()", source[request_again:])
        self.assertNotIn(
            "submitAgentToolDecision(tool.id",
            source[request_again:],
        )
        self.assertIn("onRequestAgain={handleRetry}", assistant)
        self.assertIn("pendingMessageRetries.get(retryKey)", chat_store)
        self.assertIn("pendingMessageRetries.set(retryKey, request)", chat_store)
        self.assertIn("pendingMessageRetries.delete(retryKey)", chat_store)
        self.assertIn("resolveToolCallProjection(toolCall, projection)", detail)
        self.assertIn(
            "t(`chat.message.toolCall.status.${projected.status}`)",
            detail,
        )
        for locale_key in (
            "chat.message.toolCall.server",
            "chat.message.toolCall.arguments",
            "chat.message.toolCall.result",
            "chat.message.toolCall.approval",
            "chat.message.toolCall.progress",
        ):
            with self.subTest(locale_key=locale_key):
                self.assertIn(locale_key, detail)
        for literal in (
            'label="Server"',
            'label="Arguments"',
            'label="Result"',
            "Approved by",
            'label="Progress"',
        ):
            with self.subTest(literal=literal):
                self.assertNotIn(literal, detail)

if __name__ == "__main__":
    unittest.main()
