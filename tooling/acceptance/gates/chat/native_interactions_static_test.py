from __future__ import annotations

import os
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat.contact_message_resilience_runner import (
    ContactMessageResilienceGate,
)
from tooling.acceptance.gates.chat.native_interactions_runner import (
    NativeInteractionsGate,
    station_mutation_fingerprint,
)


ROOT = Path(__file__).resolve().parents[4]


class NativeInteractionContractsTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_harness_uses_canonical_production_actions(self) -> None:
        source = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        for method in (
            "sendInteractionMessage",
            "editInteractionMessage",
            "submitMetadataInteraction",
            "submitReadCursor",
            "submitTyping",
            "interactionProjection",
            "openInteractionThread",
            "deleteLocalInteractionMessage",
            "revokeCurrentDevice",
            "typingProjection",
        ):
            self.assertIn(method, source)
        self.assertIn("imServiceV1.messaging.sendMessage", source)
        self.assertIn("api.messagingReadCursor", source)
        self.assertIn("api.messagingTypingSend", source)

    def test_native_actor_aliases_use_canonical_dev_accounts(self) -> None:
        support = self.source(
            "tooling/acceptance/gates/chat/native_support.py"
        )
        self.assertIn('"alice": "alice@p.t"', support)
        self.assertIn('"bob": "bob@p.t"', support)
        self.assertIn('"charlie": "carol@p.t"', support)
        self.assertIn('DEV_ACCOUNT_PASSWORD = "1"', support)
        self.assertNotIn('"charlie": "charlie@p.t"', support)
        self.assertNotIn("CHAT_ACCEPTANCE_PASSWORD", support)

    def test_native_fixture_reset_runs_through_the_package_module(self) -> None:
        support = self.source(
            "tooling/acceptance/gates/chat/native_support.py"
        )
        self.assertIn(
            '"tooling.acceptance.fixtures.chat_native_reset"',
            support,
        )
        self.assertNotIn(
            '"fixtures"\\n                / "chat_native_reset.py"',
            support,
        )

    def test_native_runners_use_committed_dev_account_fixture(self) -> None:
        for path in (
            "tooling/acceptance/gates/chat/native_two_client_runner.py",
            "tooling/acceptance/gates/chat/native_interactions_runner.py",
            "tooling/acceptance/gates/chat/native_typing_runner.py",
        ):
            with self.subTest(path=path):
                self.assertNotIn(
                    "CHAT_ACCEPTANCE_PASSWORD",
                    self.source(path),
                )

    def test_native_dom_selectors_cover_interaction_and_typing_state(self) -> None:
        row = self.source(
            "apps/desktop/src/components/chat/message/ChatMessageRow.tsx"
        )
        overlay = self.source(
            "apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx"
        )
        area = self.source("apps/desktop/src/components/chat/ChatMessageArea.tsx")
        thread = self.source("apps/desktop/src/components/chat/ChatThreadPanel.tsx")
        for selector in (
            'data-message-action="edit"',
            'data-message-action="retract"',
            'data-message-action="reaction"',
            'data-message-action="pin"',
        ):
            self.assertIn(selector, overlay)
        for selector in (
            "data-message-edited=",
            "data-message-retracted=",
            "data-message-reply-to=",
            "data-message-thread-root=",
            "data-message-read-by=",
            'data-message-read-state="read"',
        ):
            self.assertIn(selector, row)
        self.assertIn("data-chat-typing=", area)
        for selector in (
            'data-chat-thread-panel="open"',
            "data-chat-thread-root=",
            "data-chat-thread-reply-count=",
            "data-thread-message-id=",
            "data-thread-message-order=",
            "data-thread-message-role=",
        ):
            self.assertIn(selector, thread)
        self.assertIn("data-message-reply-target-state=", row)
        self.assertIn("replyTargetUnavailable", row)

    def test_engine_readback_is_acceptance_feature_gated(self) -> None:
        store = self.source("apps/desktop/src-tauri/src/messaging/store.rs")
        gateway = self.source(
            "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"
        )
        self.assertIn('#[cfg(feature = "acceptance-webdriver")]', store)
        self.assertIn("acceptance_interaction_snapshot", store)
        self.assertIn('#[cfg(feature = "acceptance-webdriver")]', gateway)
        self.assertIn("messaging_acceptance_interaction_snapshot", gateway)
        self.assertIn('"outbox": outbox', store)
        self.assertIn('"attemptCount"', store)
        self.assertIn('"commandSha256"', store)

    def test_interaction_commands_catch_up_before_target_validation(self) -> None:
        source = self.source(
            "apps/desktop/src-tauri/src/messaging/engine.rs"
        )
        for method, next_method in (
            ("pub fn submit_edit(", "pub fn submit_metadata_interaction("),
            ("pub fn submit_metadata_interaction(", "pub fn submit_read_cursor("),
        ):
            method_start = source.index(method)
            method_end = source.index(next_method, method_start)
            body = source[method_start:method_end]

            drain = body.index(
                "self.drain_once(token, INTERACTION_PREFLIGHT_DRAIN_LIMIT)?;"
            )
            projection = body.index(".message_projection(conversation_id, message_id)?")
            self.assertLess(drain, projection)

    def test_native_runners_are_observation_bounded_and_source_bound(self) -> None:
        for path in (
            "tooling/acceptance/gates/chat/native_interactions_runner.py",
            "tooling/acceptance/gates/chat/native_typing_runner.py",
        ):
            source = self.source(path)
            self.assertIn("current_workspace_digest", source)
            self.assertIn("read_station_version", source)
            self.assertIn("wait_until(", source)
            self.assertIn("station_readback", source)
            self.assertIn("messaging_acceptance_interaction_snapshot", source)
            self.assertIn(
                "acceptance_station_environment(self.station_url)",
                source,
            )
            self.assertNotIn("time.sleep(", source)
            self.assertNotIn("localhost:18080", source)

    def test_interaction_retry_preserves_the_last_submission_error(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        retry_start = source.index("            def _submit_edit()")
        retry_end = source.index(
            "            edit = wait_until(",
            retry_start,
        )
        retry_submission = source[retry_start:retry_end]

        self.assertIn("return async_harness(", retry_submission)
        self.assertNotIn("except Exception", retry_submission)
        self.assertIn("contentState={content_state}", source)

    def test_interaction_runner_binds_selected_runtime_cell(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        for required in (
            "def selected_runtime()",
            "selected_native_runtime(GATE_ID)",
            "selected runtime cell requires injected runtime resources",
            "runtime_binding.cell_id != selected_cell",
            "self.runtime_binding.create_session(",
            "self.runtime_binding.expose_orchestrator_endpoint(proxy.url).url",
            "native_runtime_source_identity(",
            "self.runtime_binding.finalize_cleanup(",
            'bool(cleanup.get("processesReleased"))',
            'bool(cleanup.get("storageReleased"))',
            '"hydrateActiveActor"',
        ):
            self.assertIn(required, source)
        self.assertIn(
            "if self.runtime_binding is None:\n"
            "            return start_authenticated_client(",
            source,
        )
        self.assertIn(
            "if self.runtime_binding is None:\n"
            "            try:\n"
            "                acceptance_station_environment(self.station_url)",
            source,
        )

    def test_selected_runtime_rejects_uninjected_gate_construction(self) -> None:
        previous = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL")
        os.environ["PT_ACCEPTANCE_RUNTIME_CELL"] = "desktop-linux-native"
        try:
            for gate in (
                NativeInteractionsGate,
                ContactMessageResilienceGate,
            ):
                with self.subTest(gate=gate.__name__):
                    with self.assertRaisesRegex(
                        GateError,
                        "requires injected runtime resources",
                    ):
                        gate()
        finally:
            if previous is None:
                os.environ.pop("PT_ACCEPTANCE_RUNTIME_CELL", None)
            else:
                os.environ["PT_ACCEPTANCE_RUNTIME_CELL"] = previous

    def test_mutation_fingerprint_ignores_receipts_but_tracks_authority_fanout(
        self,
    ) -> None:
        before = {
            "authorityEvents": [{"eventId": "event-1"}],
            "queue": [
                {"itemId": "fanout-1", "eventId": "event-1"},
                {"itemId": "receipt-1", "eventId": "message-1"},
            ],
        }
        receipt_only = {
            **before,
            "queue": [
                *before["queue"],
                {"itemId": "receipt-2", "eventId": "message-2"},
            ],
        }
        authority_mutation = {
            "authorityEvents": [
                *before["authorityEvents"],
                {"eventId": "event-2"},
            ],
            "queue": [
                *receipt_only["queue"],
                {"itemId": "fanout-2", "eventId": "event-2"},
            ],
        }

        self.assertEqual(
            station_mutation_fingerprint(before),
            station_mutation_fingerprint(receipt_only),
        )
        self.assertNotEqual(
            station_mutation_fingerprint(before),
            station_mutation_fingerprint(authority_mutation),
        )

    def test_interaction_gate_fails_closed_on_every_w12_variant(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        for assertion in (
            "direct_reply_thread_panel",
            "direct_reply_target_unavailable",
            "direct_author_only_retract",
            "direct_reaction_remove_convergence",
            "direct_offline_recovery",
            "direct_duplicate_queue_replay",
            "group_reply_thread_panel",
            "group_reply_target_unavailable",
            "group_author_only_retract",
            "group_reaction_remove_convergence",
            "group_offline_recovery",
            "group_duplicate_queue_replay",
            "group_removed_member_denied",
            "revoked_device_denied",
            "pending_interaction_timeout_retry",
            "station_restart_convergence",
            "resources_released",
        ):
            self.assertIn(f'"{assertion}"', source)
        self.assertIn('self.prove_lifecycle("friend"', source)
        self.assertIn(
            'self.prove_pending_timeout_retry("friend", direct_id)',
            source,
        )
        self.assertIn(
            'self.prove_pending_timeout_retry("group", group_id)',
            source,
        )
        self.assertNotIn('self.prove_lifecycle("direct"', source)
        self.assertNotIn("CancelPendingMessagingCommand", source)
        self.assertNotIn("cancel_pending", source)

    def test_timeout_retry_uses_disposable_station_fault_proxy(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        proxy = self.source(
            "tooling/acceptance/fixtures/chat_submit_fault_proxy.py"
        )
        self.assertIn("AcceptanceStationSubmitFaultProxy", runner)
        self.assertIn("arm_connection_loss", runner)
        self.assertIn('"messaging_dispatch"', runner)
        self.assertIn('"retry_wait"', runner)
        self.assertIn("receiverVisibleCount", runner)
        self.assertIn('SUBMIT_PATH = "/messaging/command/submit"', proxy)
        self.assertIn("acceptance_station_environment(station_url)", proxy)
        self.assertIn("requestSha256", proxy)
        self.assertIn("commandSha256", proxy)
        self.assertIn("_submit_command_bytes", proxy)
        self.assertNotIn("localhost:18080", proxy)

    def test_disposable_station_restart_is_remote_and_source_bound(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        fixture = self.source(
            "tooling/acceptance/fixtures/chat_native_reset.py"
        )
        self.assertIn("restart_acceptance_station", runner)
        self.assertNotIn('"station-restart"', runner)
        self.assertIn("CHAT_ACCEPTANCE_ALLOW_STATION_RESTART", fixture)
        self.assertIn("docker restart", fixture)
        self.assertIn(".State.StartedAt", fixture)
        self.assertIn("parsed_url.hostname != host", fixture)
        self.assertIn("parsed_url.port != expected.port", fixture)
        self.assertIn("PT_ACCEPTANCE_DISPOSABLE", fixture)
        self.assertIn("PT_ACCEPTANCE_COMPOSE_PROJECT", fixture)
        self.assertIn("PT_ACCEPTANCE_POSTGRES_VOLUME", fixture)
        self.assertIn("verify_disposable_station_runtime", fixture)
        self.assertIn("beforeCommit", fixture)
        self.assertIn("afterCommit", fixture)
        self.assertIn("lane_row.next_sequence + 1", fixture)
        self.assertIn("SET next_sequence = next_sequence + 1", fixture)
        self.assertIn("reset_local_client_storage", fixture)
        self.assertIn("shutil.rmtree(storage)", fixture)
        self.assertNotIn("reset_local_messaging_databases", fixture)
        self.assertIn("self.station_url,", runner)
        self.assertIn('"cleanup": self.cleanup_evidence', runner)
        self.assertIn("device changed across client restart", runner)

    def test_typing_gate_requires_full_group_lifecycle_and_cleanup(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_typing_runner.py"
        )
        for assertion in (
            "group_typing_start_stop",
            "group_typing_send_clear",
            "group_typing_blur_clear",
            "group_typing_switch_clear",
            "group_typing_disconnect_ttl_clear",
            "group_removed_member_rejected",
            "typing_revoked_device_rejected",
            "typing_has_zero_durable_writes",
            "resources_released",
        ):
            self.assertIn(f'"{assertion}"', source)
        self.assertIn("port_is_free", source)
        self.assertIn('"cleanup": self.cleanup_evidence', source)
        self.assertIn("device changed after disconnect restart", source)

    def test_gate_catalog_runs_dedicated_native_gates(self) -> None:
        gates = self.source("tooling/acceptance/gates.yaml")
        self.assertIn('"chat-native-interactions-e2e"', gates)
        self.assertIn(
            "python3 -m tooling.acceptance.gates.chat.native_interactions_runner",
            gates,
        )
        self.assertIn('"chat-native-typing-e2e"', gates)
        self.assertIn(
            "python3 -m tooling.acceptance.gates.chat.native_typing_runner",
            gates,
        )
        self.assertIn(
            "tooling.acceptance.gates.chat.chat_native_reset_test",
            gates,
        )

    def test_timeout_fault_fixture_selects_interaction_gate(self) -> None:
        registry = self.source("tooling/acceptance/registry.yaml")
        self.assertIn(
            '"apps/desktop/src/services/desktop_api.ts"',
            registry,
        )
        self.assertIn(
            '"tooling/acceptance/fixtures/chat_submit_fault_proxy.py"',
            registry,
        )
        self.assertIn(
            '"tooling/acceptance/gates/chat/chat_submit_fault_proxy_test.py"',
            registry,
        )


class ContactMessageResilienceTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_message_button_navigates_before_create_direct_resolves(self) -> None:
        src = self.source(
            "apps/desktop/src/components/chat/ChatContactsDetailPanel.tsx"
        )
        create_direct_pos = src.find("createDirect(peerDid)")
        self.assertGreater(
            create_direct_pos, 0,
            "handleMessage must call imServiceV1.messaging.createDirect",
        )
        set_opening_pos = src.rfind("setOpeningConversation(true)", 0, create_direct_pos)
        on_message_before_create = src.rfind("onMessage()", set_opening_pos, create_direct_pos)
        self.assertGreater(
            on_message_before_create, set_opening_pos,
            "onMessage() must be called BEFORE createDirect resolves; "
            "navigation must not be blocked by async API failure",
        )
        try_block_start = src.find("try {", on_message_before_create)
        self.assertGreater(try_block_start, on_message_before_create)
        self.assertGreater(create_direct_pos, try_block_start)
        catch_block = src.find("} catch", create_direct_pos)
        self.assertGreater(catch_block, create_direct_pos)
        self.assertIn(
            "presentError", src[create_direct_pos:catch_block + 200],
            "errors must be presented within the already-open chat view",
        )

    def test_runner_binds_selected_runtime_cell(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/contact_message_resilience_runner.py"
        )
        for required in (
            "def selected_runtime()",
            "selected_native_runtime(GATE_ID)",
            "selected runtime cell requires injected runtime resources",
            "runtime_binding.cell_id != selected_cell",
            "self.runtime_binding.create_session(",
            "self.runtime_binding.expose_orchestrator_endpoint(",
            "native_runtime_source_identity(",
            "self.runtime_binding.finalize_cleanup(",
            'bool(cleanup.get("processesReleased"))',
            'bool(cleanup.get("storageReleased"))',
            '"hydrateActiveActor"',
        ):
            self.assertIn(required, source)
        self.assertIn(
            "if self.runtime_binding is None:\n"
            "            return start_authenticated_client(",
            source,
        )
        self.assertIn(
            "if self.runtime_binding is None:\n"
            "            try:\n"
            "                acceptance_station_environment(self.station_url)",
            source,
        )

    def test_engine_has_stale_enrollment_recovery(self) -> None:
        src = self.source("apps/desktop/src-tauri/src/messaging/engine.rs")
        self.assertIn(
            "recover_stale_enrollment", src,
            "engine must provide recover_stale_enrollment for endpoint-not-active recovery",
        )
        self.assertIn(
            "is_stale_endpoint_error", src,
            "engine must provide is_stale_endpoint_error to detect stale endpoint errors "
            "from both explicit messages and empty-body 403 responses",
        )

        helper = src.find("fn is_stale_endpoint_error")
        self.assertGreater(helper, 0)
        self.assertIn(
            "endpoint is not active", src[helper:helper + 300],
            "is_stale_endpoint_error must detect 'endpoint is not active' in error text",
        )
        self.assertIn(
            "station returned 403", src[helper:helper + 300],
            "is_stale_endpoint_error must detect 'station returned 403' because protobuf "
            "endpoints return 403 with empty body when the endpoint is not active",
        )

        create_direct = src.find("fn create_direct_conversation")
        self.assertGreater(create_direct, 0)

        first_attempt = src.find("try_create_direct_conversation", create_direct)
        self.assertGreater(
            first_attempt, create_direct,
            "create_direct_conversation must delegate to try_create_direct_conversation",
        )

        guard = src.find("is_stale_endpoint_error", first_attempt)
        self.assertGreater(
            guard, first_attempt,
            "recovery must be guarded by is_stale_endpoint_error",
        )

        recovery = src.find("recover_stale_enrollment", guard)
        enroll = src.find("enroll_pending_device", recovery)
        retry = src.find("try_create_direct_conversation", enroll)
        self.assertGreater(
            recovery, first_attempt,
            "recover_stale_enrollment must be called after the first attempt fails",
        )
        self.assertGreater(
            enroll, recovery,
            "enroll_pending_device must be called after recover_stale_enrollment",
        )
        self.assertGreater(
            retry, enroll,
            "try_create_direct_conversation must be RETRIED after re-enrollment; "
            "without the retry the recovery has no effect",
        )

        recovery_block = src[recovery:enroll]
        self.assertNotIn(
            "if self.recover_stale_enrollment",
            recovery_block,
            "enroll_pending_device must NOT be gated on recover_stale_enrollment's return "
            "value: when the device is already in awaiting_device_enrollment state, "
            "reset_device_enrollment returns false but the pending enrollment still "
            "needs to be submitted to Station",
        )

        non_matching_arm = src.find("Err(error) => Err(error)", retry)
        self.assertGreater(
            non_matching_arm, 0,
            "non-stale-endpoint errors must pass through without recovery",
        )

    def test_store_has_reset_device_enrollment(self) -> None:
        src = self.source("apps/desktop/src-tauri/src/messaging/store.rs")
        self.assertIn(
            "fn reset_device_enrollment", src,
            "store must provide reset_device_enrollment to re-trigger enrollment "
            "when Station loses device state",
        )
        self.assertIn(
            "awaiting_device_enrollment", src,
            "reset_device_enrollment must set status back to awaiting_device_enrollment",
        )
        self.assertIn(
            "status = 'active'", src,
            "reset_device_enrollment must have an idempotent WHERE status = 'active' "
            "guard so it is a no-op when the device is already pending enrollment",
        )
        self.assertIn(
            "Ok(rows > 0)", src,
            "reset_device_enrollment must return Ok(true) only when a row was actually "
            "reset, enabling the caller to distinguish 'reset performed' from 'already pending'",
        )

    def test_lifecycle_recovers_stale_enrollment(self) -> None:
        src = self.source("apps/desktop/src-tauri/src/messaging/lifecycle.rs")
        self.assertIn(
            "recover_stale_enrollment", src,
            "lifecycle must call engine.recover_stale_enrollment on stale endpoint errors",
        )
        failure_branch = src.find("if failures.is_empty()")
        self.assertGreater(
            failure_branch, 0,
            "run_cycle must have a failures.is_empty() check",
        )
        recovery = src.find("recover_stale_enrollment", failure_branch)
        err_return = src.rfind("Err(combined)")
        self.assertGreater(
            recovery, failure_branch,
            "recover_stale_enrollment must be called inside the failure branch "
            "(after the is_empty check), not unconditionally",
        )
        self.assertGreater(
            err_return, recovery,
            "the cycle error must still be propagated as Err(combined) after "
            "attempting recovery; recovery is a side-effect, not a success override",
        )
        self.assertNotIn(
            'combined.contains("endpoint is not active")', src,
            "lifecycle must not duplicate the stale-endpoint string check; "
            "recover_stale_enrollment now internally detects both 'endpoint is not active' "
            "and 'station returned 403' via is_stale_endpoint_error",
        )

    def test_contact_double_click_starts_chat(self) -> None:
        src = self.source("apps/desktop/src/components/chat/ChatContactsPanel.tsx")
        double_clicks = [i for i in range(len(src)) if src.startswith("onDoubleClick", i)]
        self.assertGreaterEqual(
            len(double_clicks), 2,
            "ChatContactsPanel must provide onDoubleClick on both friend and group rows "
            "so users can start a chat without opening the detail panel",
        )
        self.assertIn(
            "onStartChat", src,
            "ChatContactsPanel must accept onStartChat prop for double-click entry",
        )

        group_kind_pos = src.find("kind: 'group'")
        friend_kind_pos = src.find("kind: 'friend'")
        self.assertGreater(
            group_kind_pos, 0,
            "group row double-click must pass kind: 'group' so the page can distinguish "
            "group navigation from friend navigation",
        )
        self.assertGreater(
            friend_kind_pos, 0,
            "friend row double-click must pass kind: 'friend' so the page can distinguish "
            "friend navigation from group navigation",
        )
        self.assertNotEqual(
            group_kind_pos, friend_kind_pos,
            "group and friend double-click handlers must be distinct",
        )

        first_dc = double_clicks[0]
        second_dc = double_clicks[1]
        first_kind = src.find("kind:", first_dc, second_dc)
        second_kind = src.find("kind:", second_dc)
        self.assertGreater(
            first_kind, first_dc,
            "the first onDoubleClick handler must invoke onStartChat with a kind",
        )
        self.assertGreater(
            second_kind, second_dc,
            "the second onDoubleClick handler must invoke onStartChat with a kind",
        )

        page = self.source("apps/desktop/src/pages/SocialChatPage.tsx")
        self.assertIn(
            "onStartChat", page,
            "SocialChatPage must wire onStartChat to navigate to the chats subpage",
        )

    def test_search_dropdown_dismisses_on_backdrop_click(self) -> None:
        src = self.source(
            "apps/desktop/src/components/chat/ChatSearchDropdown.tsx"
        )
        self.assertIn(
            "onDismiss", src,
            "ChatSearchDropdown must accept onDismiss to close the dropdown "
            "when the user clicks outside",
        )
        self.assertIn(
            'inset: 0', src,
            "ChatSearchDropdown must render a full-screen backdrop to capture "
            "outside clicks for dismissal",
        )
        self.assertIn(
            "onClick={onDismiss}", src,
            "the backdrop div must wire onClick directly to onDismiss so that "
            "clicking outside actually triggers dismissal",
        )

        conditional = src.find("{onDismiss && (")
        self.assertGreater(
            conditional, 0,
            "the backdrop must be conditionally rendered only when onDismiss is provided, "
            "avoiding a click-capturing overlay in contexts that don't need dismissal",
        )

        backdrop_z = src.find("zIndex: 19", conditional)
        dropdown_z = src.find("zIndex: 20", backdrop_z)
        self.assertGreater(
            backdrop_z, conditional,
            "backdrop must have zIndex 19",
        )
        self.assertGreater(
            dropdown_z, backdrop_z,
            "dropdown must have zIndex 20, above the backdrop at 19, so the dropdown "
            "itself remains clickable while the backdrop captures outside clicks",
        )

        session = self.source("apps/desktop/src/components/chat/ChatSessionList.tsx")
        self.assertIn(
            "onDismiss", session,
            "ChatSessionList must wire onDismiss to clear search text",
        )

    def test_settings_reset_logs_out_before_reset(self) -> None:
        src = self.source("apps/desktop/src/pages/SettingsPage.tsx")
        logout_pos = src.find("api.authLogout()")
        reset_pos = src.find("api.resetOnboarding()", logout_pos)
        self.assertGreater(
            logout_pos, 0,
            "Settings danger-zone reset must call api.authLogout() first",
        )
        self.assertGreater(
            reset_pos, logout_pos,
            "authLogout() must be called BEFORE resetOnboarding() so the server "
            "session is invalidated before local state is wiped",
        )

        warm_resume_pos = src.find("clearWarmResume()", reset_pos)
        self.assertGreater(
            warm_resume_pos, reset_pos,
            "clearWarmResume() must be called after resetOnboarding() so the reload "
            "lands on onboarding, not the ready view",
        )

        session_clear_pos = src.find("sessionStorage.clear()", warm_resume_pos)
        self.assertGreater(
            session_clear_pos, warm_resume_pos,
            "sessionStorage.clear() must be called after clearWarmResume()",
        )

    def test_message_draft_persists_per_conversation(self) -> None:
        src = self.source("apps/desktop/src/components/chat/ChatMessageArea.tsx")
        self.assertIn(
            "draftsRef", src,
            "ChatMessageArea must keep a per-conversation draft map so typed text "
            "survives conversation switches",
        )
        self.assertIn(
            "prevActiveRef", src,
            "ChatMessageArea must track the previous conversation to save its "
            "draft before switching",
        )
        save_pos = src.find("draftsRef.current[prev]")
        restore_pos = src.find("draftsRef.current[activeUlid", save_pos)
        self.assertGreater(
            save_pos, 0,
            "ChatMessageArea must save the outgoing conversation draft before switching",
        )
        self.assertGreater(
            restore_pos, save_pos,
            "ChatMessageArea must restore the incoming conversation draft after saving",
        )

    def test_station_member_index_repair_is_idempotent_and_correct(self) -> None:
        src = self.source(
            "apps/station/app/subserver/conversation/repository.go"
        )
        self.assertIn(
            "func repairMemberIndex", src,
            "repository must provide repairMemberIndex to migrate the legacy "
            "actor_did index to ptid-based index",
        )

        self.assertIn(
            "actor_did", src,
            "repairMemberIndex must detect the legacy 'actor_did' column to decide "
            "whether repair is needed",
        )

        early_return = src.find("len(columns) == 0")
        self.assertGreater(
            early_return, 0,
            "repairMemberIndex must return early when the index does not exist "
            "(fresh install), avoiding unnecessary DDL",
        )

        drop_old = src.find("DROP INDEX IF EXISTS idx_member_conv_actor")
        create_new = src.find(
            "CREATE UNIQUE INDEX idx_member_conv_actor",
            drop_old,
        )
        self.assertGreater(
            drop_old, 0,
            "repair must DROP the legacy index before creating the new one",
        )
        self.assertGreater(
            create_new, drop_old,
            "repair must CREATE the new unique index after dropping the old one",
        )
        self.assertIn(
            "(conversation_id, ptid)",
            src[create_new:create_new + 200],
            "new idx_member_conv_actor must be on (conversation_id, ptid)",
        )

        drop_secondary = src.find(
            "DROP INDEX IF EXISTS idx_member_actor", create_new,
        )
        create_secondary = src.find(
            "CREATE INDEX idx_member_actor", drop_secondary,
        )
        self.assertGreater(
            drop_secondary, create_new,
            "repair must also DROP the legacy idx_member_actor secondary index",
        )
        self.assertGreater(
            create_secondary, drop_secondary,
            "repair must CREATE the replacement idx_member_actor on (ptid)",
        )
        self.assertIn(
            "(ptid)", src[create_secondary:create_secondary + 100],
            "replacement idx_member_actor must be on (ptid)",
        )

        subserver = self.source(
            "apps/station/app/subserver/conversation/subserver.go"
        )
        self.assertIn(
            "repairMemberIndex(rds)", subserver,
            "subserver Init must call repairMemberIndex during startup",
        )
        init_pos = subserver.find("func (s *subServer) Init")
        call_pos = subserver.find("repairMemberIndex(rds)", init_pos)
        self.assertGreater(
            call_pos, init_pos,
            "repairMemberIndex must be called within the Init function",
        )

    def test_toast_host_is_mounted_at_app_root(self) -> None:
        src = self.source("apps/desktop/src/main.tsx")
        self.assertIn(
            "ToastHost", src,
            "main.tsx must import and mount ToastHost so that presented errors "
            "are rendered globally; without it, resilience error toasts are invisible",
        )
        import_pos = src.find("ToastHost")
        render_pos = src.rfind("<ToastHost />")
        self.assertGreater(
            import_pos, 0,
            "ToastHost must be imported in main.tsx",
        )
        self.assertGreater(
            render_pos, import_pos,
            "<ToastHost /> must be rendered in the React tree, not just imported",
        )

    def test_chat_error_mapping_propagates_debug_message(self) -> None:
        src = self.source(
            "apps/desktop/src/services/errorMappings/chatErrorMapping.ts"
        )
        self.assertIn(
            "debugMessage?: string", src,
            "presentedError must accept an optional debugMessage parameter "
            "for diagnostic context propagation",
        )
        self.assertIn(
            "debugMessage,", src,
            "presentedError must include debugMessage in the returned PresentedError",
        )
        fallback_pos = src.rfind("return presentedError(")
        self.assertIn(
            "message", src[fallback_pos:],
            "the fallback error mapper must pass the raw error message as debugMessage "
            "so operators can diagnose the underlying failure",
        )


if __name__ == "__main__":
    unittest.main()
