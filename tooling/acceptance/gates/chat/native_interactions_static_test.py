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
            "engineInteractionSnapshot",
            "removeGroupMember",
        ):
            self.assertIn(method, source)
        self.assertIn("imServiceV1.messaging.sendMessage", source)
        self.assertIn("api.messagingReadCursor", source)
        self.assertIn("api.messagingTypingSend", source)

    def test_terminal_group_restart_uses_registered_message_page_action(self) -> None:
        harness = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        restart_start = runner.index("    def restart_terminal_group_client(")
        restart_end = runner.index("    def prove_group_lifecycle(", restart_start)
        restart_source = runner[restart_start:restart_end]

        self.assertIn("async messagePage({", harness)
        self.assertIn('"messagePage"', restart_source)
        self.assertNotIn('"listMessagePage"', restart_source)

    def test_thread_projection_uses_the_thread_specific_read_model(self) -> None:
        harness = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )

        self.assertIn("socialThreadKey(", harness)
        self.assertIn("social.loadThreadMessages(", harness)
        self.assertIn(
            '"threadRootMessageId": thread_root_message_id',
            runner,
        )
        self.assertIn(
            "delivery_station = runtime_station_service(self.manifest, actor)",
            runner,
        )
        self.assertIn("deployment_environment=delivery_environment", runner)

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
        self.assertIn(
            '#[cfg(any(test, feature = "acceptance-webdriver"))]',
            store,
        )
        self.assertIn("acceptance_interaction_snapshot", store)
        self.assertIn('#[cfg(feature = "acceptance-webdriver")]', gateway)
        self.assertIn("messaging_acceptance_interaction_snapshot", gateway)
        self.assertIn('"outbox": outbox', store)
        self.assertIn('"attemptCount"', store)
        self.assertIn('"commandSha256"', store)

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
            self.assertIn("engineInteractionSnapshot", source)
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

    def test_group_sync_waits_for_eventual_member_projection(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        sync_start = source.index("    def sync(")
        sync_end = source.index("    def group_lifecycle_snapshot(", sync_start)
        sync_source = source[sync_start:sync_end]

        self.assertIn('if kind == "friend":', sync_source)
        self.assertIn("wait_until(", sync_source)
        self.assertIn('f"{actor} projected Group {conversation_id}"', sync_source)
        self.assertIn("STEP_TIMEOUT", sync_source)

    def test_interaction_runner_binds_selected_runtime_cell(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        for required in (
            "def selected_runtime()",
            "selected_native_runtime(GATE_ID)",
            "selected runtime cell requires injected runtime resources",
            "runtime_binding.cell_id != selected_cell",
            "self.runtime_binding.create_bound_session(",
            "self.runtime_binding.create_transport_override(",
            "self.runtime_binding.apply_transport_override(",
            "self.runtime_binding.clear_transport_override(",
            "native_runtime_source_identity(",
            "self.runtime_binding.finalize_cleanup(",
            'bool(cleanup.get("processesReleased"))',
            'bool(cleanup.get("storageReleased"))',
            '"hydrateActiveActor"',
        ):
            self.assertIn(required, source)
        self.assertNotIn("expose_orchestrator_endpoint(", source)
        self.assertNotIn("start_authenticated_client(", source)

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
        self.assertNotIn('"messaging_dispatch"', runner)
        self.assertNotIn('"messaging_drain"', runner)
        self.assertNotIn("def drain(", runner)
        self.assertNotIn("self.drain(", runner)
        self.assertIn('"engineInteractionSnapshot"', runner)
        self.assertIn('"retry_wait"', runner)
        self.assertIn("receiverVisibleCount", runner)
        self.assertIn(
            'CONVERSATION_COMMAND_PATH = "/conversation/command"',
            proxy,
        )
        self.assertNotIn('"/messaging/', proxy)
        self.assertIn("acceptance_station_environment(station_url)", proxy)
        self.assertIn("requestSha256", proxy)
        self.assertIn("commandSha256", proxy)
        self.assertIn("_authority_command_bytes", proxy)
        self.assertNotIn("localhost:18080", proxy)

    def test_native_interactions_use_window_owned_membership_and_engine(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        self.assertIn('"actorPtid": self.ptids[actor]', runner)
        self.assertIn('"conversationId": conversation_id', runner)
        self.assertIn('"messageId": message_id', runner)
        self.assertIn('"commandId": command_id', runner)
        self.assertIn('"removeGroupMember"', runner)
        self.assertIn('"groupUlid": conversation_id', runner)
        self.assertIn('"memberPtid": self.ptids["charlie"]', runner)
        self.assertNotIn("gateway_command", runner)
        self.assertNotIn('"messaging_membership_transition"', runner)

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

    def test_message_button_opens_peer_bound_recovery_surface(self) -> None:
        contacts = self.source(
            "apps/desktop/src/components/chat/ChatContactsDetailPanel.tsx"
        )
        page = self.source("apps/desktop/src/pages/SocialChatPage.tsx")
        area = self.source(
            "apps/desktop/src/components/chat/ChatMessageArea.tsx"
        )
        runner = self.source(
            "tooling/acceptance/gates/chat/contact_message_resilience_runner.py"
        )

        self.assertIn("onMessage(selectedContact)", contacts)
        self.assertNotIn("messaging.createDirect", contacts)

        intent_pos = page.find("setDirectOpenIntent(intent)")
        create_direct_pos = page.find(
            "imServiceV1.messaging.createDirect({"
        )
        navigation_pos = page.find("setSubPage('chats')", intent_pos)
        self.assertGreater(
            create_direct_pos, 0,
            "SocialChatPage must own the Direct-open command lifecycle",
        )
        self.assertGreater(
            intent_pos, 0,
            "peer-bound intent must be published before the command starts",
        )
        self.assertGreater(navigation_pos, intent_pos)
        self.assertGreater(create_direct_pos, navigation_pos)
        create_direct_end = page.find("}).then((conversation)", create_direct_pos)
        self.assertGreater(create_direct_end, create_direct_pos)
        self.assertIn(
            "peerPtid: contact.peerPtid",
            page[create_direct_pos:create_direct_end],
        )
        self.assertIn(
            "federationId: contact.federationId",
            page[create_direct_pos:create_direct_end],
        )
        self.assertIn("mode: 'inline'", page)
        self.assertIn("failDirectConversationOpen", page)

        for selector in (
            "data-chat-conversation-intent=",
            "data-chat-conversation-intent-state=",
            "data-chat-conversation-intent-error=",
            "data-chat-conversation-intent-retry",
        ):
            self.assertIn(selector, area)

        self.assertIn("peer_bound_conversation_intent_visible", runner)
        self.assertIn("error_displayed_in_peer_bound_view", runner)
        self.assertIn("conversation_retry_visible", runner)
        self.assertNotIn(
            "self._chats_subpage_active() or self._chat_area_visible()",
            runner,
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
            "self.runtime_binding.create_bound_session(",
            "self.runtime_binding.create_transport_override(",
            "self.runtime_binding.apply_transport_override(",
            "self.runtime_binding.clear_transport_override(",
            "native_runtime_source_identity(",
            "self.runtime_binding.finalize_cleanup(",
            'bool(cleanup.get("processesReleased"))',
            'bool(cleanup.get("storageReleased"))',
            '"hydrateActiveActor"',
        ):
            self.assertIn(required, source)
        self.assertNotIn("expose_orchestrator_endpoint(", source)
        self.assertNotIn("start_authenticated_client(", source)


    def test_engine_has_stale_enrollment_recovery(self) -> None:
        src = self.source("apps/desktop/src-tauri/src/messaging/engine.rs")
        enrollment = self.source(
            "packages/messaging-core/src/identity/enrollment.rs"
        )
        self.assertIn(
            "recover_stale_enrollment", src,
            "engine must provide recover_stale_enrollment for endpoint-not-active recovery",
        )
        self.assertIn(
            "is_stale_endpoint_error", src,
            "engine must delegate stale endpoint detection to the portable owner",
        )
        helper = enrollment.find("pub fn is_stale_endpoint_error")
        self.assertGreater(helper, 0)
        self.assertIn("endpoint is not active", enrollment[helper:helper + 400])
        self.assertIn("station returned 403", enrollment[helper:helper + 400])
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
            "pending enrollment must proceed even when reset was already pending",
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

    def test_recovery_fences_secure_content_before_identity_replacement(self) -> None:
        src = self.source(
            "apps/desktop/src-tauri/src/interface/tauri_commands/messaging_recovery.rs"
        )
        recovery = src.find("pub fn messaging_recovery_restore_latest")
        self.assertGreater(recovery, 0)
        teardown = src.find(
            "state.secure_content.teardown_actor(&session.actor_ptid)",
            recovery,
        )
        identity_restore = src.find(
            "crypto::store_identity_key(&key_ref, &archive.actor_identity_seed)",
            recovery,
        )
        profile_restore = src.find("state.messaging_engines.restore_profile(", recovery)
        post_restore_teardown = src.find(
            "state.secure_content.teardown_actor(&session.actor_ptid)",
            teardown + 1,
        )
        self.assertGreater(
            teardown,
            recovery,
            "replacement recovery must fence the stale Secure Content signing lease",
        )
        self.assertGreater(
            identity_restore,
            teardown,
            "Secure Content must be fenced before the actor identity key changes",
        )
        self.assertGreater(
            profile_restore,
            identity_restore,
            "Messaging profile replacement must happen after the identity key changes",
        )
        self.assertGreater(
            post_restore_teardown,
            profile_restore,
            "Secure Content leases recreated during recovery must be fenced after profile replacement",
        )

    def test_replacement_recovery_allocates_a_fresh_device_endpoint(self) -> None:
        src = self.source("apps/desktop/src-tauri/src/messaging/engine.rs")
        restore = src.find("pub fn restore_profile(")
        self.assertGreater(restore, 0)
        replacement = src.find("let device_identity = if preserve_device_continuity", restore)
        worker = src.find("let (worker, worker_token)", replacement)
        self.assertGreater(replacement, restore)
        self.assertGreater(worker, replacement)
        branch = src[replacement:worker]
        self.assertIn("generate_fresh_device_identity_from_seed(", branch)
        self.assertNotIn("generate_fresh_device_identity_for_device(", branch)

    def test_private_recovery_reactivates_secure_content_after_identity_fence(self) -> None:
        src = self.source("apps/desktop/src-tauri/src/social/mod.rs")
        recovery = src.find("fn recovery_lease_for_window(")
        self.assertGreater(recovery, 0)
        end = src.find("\nfn native_failure(", recovery)
        self.assertGreater(end, recovery)
        helper = src[recovery:end]
        self.assertIn(
            "Err(_) => return activate(state, window, actor_ptid, renderer_generation)",
            helper,
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
            'combined.contains("endpoint is not active")',
            src,
            "lifecycle must delegate stale-endpoint classification to the engine",
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
        self.assertGreater(
            group_kind_pos, 0,
            "group row double-click must pass kind: 'group' so the page can distinguish "
            "group navigation from friend navigation",
        )
        self.assertIn(
            "const selection = friendContactSelection(",
            src,
            "friend row must use the shared PTID-keyed contact selection",
        )
        self.assertIn(
            "onDoubleClick={() => onStartChat?.(selection)}",
            src,
            "friend row double-click must route the exact shared identity selection",
        )

        first_dc = double_clicks[0]
        second_dc = double_clicks[1]
        first_kind = src.find("kind:", first_dc, second_dc)
        self.assertGreater(
            first_kind, first_dc,
            "the first onDoubleClick handler must invoke onStartChat with a kind",
        )
        self.assertGreater(
            src.find("onStartChat?.(selection)", second_dc),
            second_dc,
            "the second onDoubleClick handler must invoke the typed friend selection",
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

    def test_station_member_schema_uses_canonical_composite_identity(self) -> None:
        models = self.source(
            "apps/station/app/subserver/conversation/infrastructure/persistence/models.go"
        )
        self.assertIn(
            'ConversationID string `gorm:"column:conversation_id;size:128;primaryKey"`',
            models,
        )
        self.assertIn(
            'PTID           string `gorm:"column:ptid;size:255;primaryKey;index"`',
            models,
        )
        composition = self.source(
            "apps/station/app/subserver/conversation/production_composition.go"
        )
        self.assertIn(
            "&persistence.ConversationMemberModel{}",
            composition,
            "production composition must migrate the canonical member model",
        )
        self.assertNotIn("repairMemberIndex", composition)

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
