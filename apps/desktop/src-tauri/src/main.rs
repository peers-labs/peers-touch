#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod bootstrap;
mod contracts;
mod domain;
mod error;
mod infrastructure;
mod interface;
mod messaging;
mod model;
mod state;

// Prost-generated `peers.actor` (session_api) and auth/oauth use `super::super::peers_touch::...`
// when including `peers_touch.model.actor.v1.ActorRef`. Mirror that path at the crate root.
pub mod peers_touch {
    pub mod model {
        pub mod actor {
            pub mod v1 {
                pub use crate::model::actor::v1::*;
            }
        }
        pub mod chat {
            pub mod v1 {
                pub use crate::model::chat::v1::*;
            }
        }
        pub mod common {
            pub mod v1 {
                pub use crate::model::common::v1::*;
            }
        }
    }
}

use interface::tauri_commands::{
    account, actor, admin, agent_growth, agent_orchestration, agent_scheduler, agent_turn, agents,
    applets, auth, channels, chat, conversation, cron, crypto, desktop_capture, federation,
    frontend_log, frontend_telemetry, group_chat, host_events, i18n, ice,
    key_exchange, mcp, memory, messaging as messaging_commands, messaging_recovery, mls,
    model_config, notebook, notification, oauth2, oss, presence, profile, provider, realtime,
    runtime_evidence, search, settings, skills, skills_market, social, station, system, tools,
    tts,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

const MESSAGING_PROJECTION_CHANGED_EVENT: &str = "messaging:projection-changed";

fn main() {
    let ctx = bootstrap::run();

    tracing::info!("Launching Tauri application");

    let app_state = Arc::new(ctx.app_state);
    let capability_worker_supervisor = Arc::new(
        application::desktop_executor_worker::CapabilityWorkerSupervisor::new(app_state.clone()),
    );

    let presence_supervisor = Arc::new(application::presence::PresenceSupervisor::new());
    let actor_device_identity = Arc::new(domain::actor_device_identity::ActorDeviceIdentity::new());
    let mls_group_manager = Arc::new(domain::mls_group::MlsGroupManager::with_actor_identity(
        actor_device_identity.clone(),
    ));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(desktop_capture::global_shortcut_plugin());

    #[cfg(feature = "acceptance-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(app_state)
        .manage(capability_worker_supervisor)
        .manage(desktop_capture::ChatScreenshotShortcutState::default())
        .manage(presence_supervisor)
        .manage(actor_device_identity)
        .manage(mls_group_manager)
        .setup(|app| {
            let resource_dir = app.path()
                .resource_dir()
                .unwrap_or_else(|e| {
                    #[cfg(any(debug_assertions, feature = "acceptance-webdriver"))]
                    {
                        tracing::warn!(
                            error = %e,
                            "Resource directory unavailable; falling back to src-tauri resources path"
                        );
                        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
                    }
                    #[cfg(not(any(debug_assertions, feature = "acceptance-webdriver")))]
                    panic!("[setup] Failed to resolve resource directory: {e}");
                });
            let state = app.state::<Arc<state::AppState>>();
            let weak_state = Arc::downgrade(state.inner());
            let projection_app = app.handle().clone();
            state
                .messaging_engines
                .set_projection_notifier(Arc::new(move |change| {
                    let Some(state) = weak_state.upgrade() else {
                        return;
                    };
                    let payload = serde_json::json!({
                        "conversationId": change.conversation_id,
                        "eventId": change.event_id,
                        "laneSequence": change.lane_sequence,
                    });
                    for session in state
                        .sessions
                        .snapshot_all()
                        .into_iter()
                        .filter(|session| session.account_id == change.profile_id)
                    {
                        if let Err(error) = projection_app.emit_to(
                            &session.window_label,
                            MESSAGING_PROJECTION_CHANGED_EVENT,
                            &payload,
                        ) {
                            tracing::warn!(
                                window = %session.window_label,
                                error = %error,
                                "messaging: failed to emit projection change"
                            );
                        }
                    }
                }))
                .expect("messaging projection notifier must initialize");
            #[cfg(debug_assertions)]
            interface::http_gateway::start(Arc::clone(state.inner()), app.handle().clone());
            application::desktop_executor_worker::start(Arc::clone(state.inner()));
            let capability_supervisor = app
                .state::<Arc<application::desktop_executor_worker::CapabilityWorkerSupervisor>>();
            if capability_supervisor.starts_automatically() {
                capability_supervisor.start().map_err(|error| {
                    std::io::Error::other(format!(
                        "start client capability supervisor: {error}"
                    ))
                })?;
            }
            if let Err(e) = state.i18n.deploy_builtin_packs(&resource_dir) {
                tracing::error!(error = %e, "Failed to deploy built-in i18n packs");
            }

            // Allow the asset:// protocol to read locally cached media files.
            // Tauri 2 disables asset:// by default; the static scope in
            // capabilities/default.json grants the permission, these calls
            // restrict the readable filesystem area to app-owned caches.
            match infrastructure::avatar_cache::avatars_dir() {
                Ok(dir) => {
                    if let Err(e) = std::fs::create_dir_all(&dir) {
                        tracing::warn!(error = %e, dir = %dir.display(), "Failed to pre-create avatar cache dir");
                    }
                    let scope = app.asset_protocol_scope();
                    if let Err(e) = scope.allow_directory(&dir, true) {
                        tracing::error!(error = %e, dir = %dir.display(), "Failed to allow avatar dir on asset scope");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to resolve avatar cache dir at startup");
                }
            }
            match infrastructure::oss_cache::attachments_dir() {
                Ok(dir) => {
                    if let Err(e) = std::fs::create_dir_all(&dir) {
                        tracing::warn!(error = %e, dir = %dir.display(), "Failed to pre-create attachment cache dir");
                    }
                    let scope = app.asset_protocol_scope();
                    if let Err(e) = scope.allow_directory(&dir, true) {
                        tracing::error!(error = %e, dir = %dir.display(), "Failed to allow attachment cache dir on asset scope");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to resolve attachment cache dir at startup");
                }
            }
            if let Err(e) = infrastructure::session_store::migrate_legacy() {
                tracing::warn!(error = %e, "session_store: migrate_legacy failed (continuing boot)");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            interface::tauri_commands::meta_contract_version,
            frontend_log::frontend_log,
            frontend_telemetry::frontend_telemetry_upload,
            i18n::i18n_load_resources,
            actor::actor_search_actors,
            actor::actor_get_my_profile,
            auth::auth_login,
            auth::access_start,
            auth::access_submit_invite_code,
            auth::access_submit_login,
            auth::auth_logout,
            auth::auth_restore_session,
            auth::auth_validate_token,
            auth::ensure_station_session,
            settings::settings_get,
            settings::settings_set,
            settings::settings_reset,
            desktop_capture::chat_screenshot_shortcut_register,
            social::social_create_moment,
            social::social_get_moment,
            social::social_delete_moment,
            social::social_list_by_author,
            social::social_get_timeline,
            social::social_sync_moments_projection,
            social::social_station_moderation_upsert,
            social::social_station_moderation_delete,
            social::social_station_moderation_list,
            social::social_react,
            social::social_unreact,
            social::social_get_comments,
            social::social_create_comment,
            social::social_delete_comment,
            social::social_follow,
            social::social_unfollow,
            social::social_get_followers,
            social::social_get_following,
            social::social_get_relationship,
            social::social_circle_create,
            social::social_circle_rename,
            social::social_circle_delete,
            social::social_circle_list_mine,
            social::social_circle_add_members,
            social::social_circle_remove_members,
            social::social_circle_list_members,
            social::social_get_my_stats,
            profile::profile_get,
            profile::peer_profile_get,
            profile::profile_update,
            profile::profile_upload_avatar,
            profile::profile_upload_header,
            profile::profile_upload_avatar_oss,
            profile::profile_upload_header_oss,
            profile::pick_image_file,
            profile::profile_update_privacy,
            profile::account_sync_avatar,
            profile::sync_user_profile,
            profile::avatar_resolve_local,
            federation::federation_get_self,
            federation::federation_update_visibility,
            federation::federation_resolve,
            federation::federation_health,
            federation::federation_catalog_search,
            federation::federation_list_federations,
            federation::federation_create,
            federation::federation_join,
            federation::federation_leave,
            federation::federation_delete,
            federation::federation_list_member_stations,
            admin::admin_health,
            admin::admin_network_probe,
            admin::admin_execute_action,
            provider::provider_list,
            provider::provider_get,
            provider::provider_update,
            provider::provider_check,
            provider::provider_create,
            provider::provider_delete,
            provider::provider_apply_preset,
            provider::provider_list_available_models,
            provider::model_fetch_remote,
            provider::model_toggle,
            provider::model_delete,
            provider::model_add,
            agents::agents_list,
            agents::agents_get_selected,
            agents::agents_set_selected,
            agents::agents_get_default,
            agents::agents_set_default,
            agents::agents_get,
            agents::agents_create,
            agents::agents_update,
            agents::agents_delete,
            agents::agents_duplicate,
            agents::agents_export_package,
            agents::agents_import_package,
            agents::agents_search,
            agent_turn::agent_execute_turn,
            agent_turn::agent_execute_turn_stream,
            agent_turn::agent_cancel_turn,
            agent_turn::agent_turn_queue_list,
            agent_turn::agent_turn_queue_cancel,
            agent_turn::agent_turn_trace_list,
            agent_turn::agent_turn_trace_get,
            agent_turn::agent_turn_diagnostics_export,
            agent_turn::agent_submit_tool_decision,
            runtime_evidence::agent_runtime_profile_effective,
            runtime_evidence::agent_capability_readiness,
            runtime_evidence::agent_capability_sessions,
            runtime_evidence::agent_browser_capability_session_open,
            runtime_evidence::agent_browser_capability_session_close,
            runtime_evidence::agent_runtime_activity_station,
            runtime_evidence::agent_runtime_activity_local,
            runtime_evidence::agent_capability_session_snapshot,
            agent_turn::agent_conversation_list,
            agent_turn::agent_conversation_get,
            agent_turn::agent_conversation_create,
            agent_turn::agent_conversation_messages,
            agent_turn::agent_conversation_update,
            agent_turn::agent_conversation_archive,
            agent_turn::agent_retry_turn,
            agent_turn::agent_regenerate_turn,
            agent_turn::agent_edit_and_resend,
            agent_turn::agent_select_active_branch,
            agent_turn::agent_tombstone_message,
            agent_turn::agent_thread_create,
            agent_turn::agent_thread_list,
            agent_turn::agent_thread_messages,
            agent_turn::agent_group_create,
            agent_turn::agent_group_update,
            agent_turn::agent_group_delete,
            agent_turn::agent_group_list,
            agent_turn::topic_comment_create,
            agent_turn::topic_comment_delete,
            agent_turn::topic_comment_list,
            agent_turn::agent_knowledge_binding_list,
            agent_turn::agent_knowledge_binding_create,
            agent_turn::agent_knowledge_binding_update,
            agent_turn::agent_knowledge_binding_delete,
            agent_turn::agent_task_create,
            agent_turn::agent_task_list,
            agent_turn::agent_task_status,
            agent_turn::agent_task_delete,
            agent_turn::agent_task_subtask_add,
            agent_turn::agent_task_subtask_complete,
            agent_turn::agent_message_translate,
            agent_orchestration::agent_collaboration_create,
            agent_orchestration::agent_collaboration_get,
            agent_orchestration::agent_collaboration_list,
            agent_orchestration::agent_collaboration_list_events,
            agent_orchestration::agent_collaboration_subscribe,
            agent_orchestration::agent_collaboration_cancel_stream,
            agent_orchestration::agent_collaboration_cancel_task,
            agent_orchestration::agent_collaboration_resume_task,
            agent_orchestration::agent_collaboration_submit_node_result,
            agent_orchestration::agent_collaboration_claim_executor_task,
            agent_orchestration::agent_collaboration_heartbeat_executor_lease,
            agent_orchestration::agent_collaboration_release_executor_lease,
            agents::agent_workspace_info,
            agents::agent_workspace_clean,
            tools::tools_list,
            tools::tools_search_providers,
            tools::tools_set_search_primary,
            search::help_get,
            search::search_sources,
            search::search_query,
            search::search_ai,
            system::system_health,
            system::open_external_url,
            system::onboarding_reset,
            system::statistics_get,
            system::preferences_get,
            system::preferences_set,
            system::share_create,
            system::share_delete,
            system::share_get,
            system::logs_tail,
            system::oauth_simulate_lark_start,
            system::oauth_simulate_lark_poll,
            system::oauth_simulate_lark_create_bot_session,
            system::config_section_get,
            system::config_section_set,
            system::config_field_reset,
            system::config_test_postgres,
            system::embedding_models_list,
            system::visitor_heartbeat,
            system::visitor_online,
            system::context_snapshot_get,
            system::context_action_dispatch,
            system::context_capabilities,
            system::context_health,
            skills::skills_list,
            skills::skills_search,
            skills::skills_get,
            skills::skills_get_builtin,
            skills::skills_create,
            skills::skills_update,
            skills::skills_delete,
            skills::skills_toggle,
            skills::skills_versions,
            skills::skills_rollback,
            skills_market::skills_import_url,
            skills_market::skills_import_github,
            skills_market::skills_import_zip,
            skills_market::skills_validate_zip,
            skills_market::skills_market_dir,
            skills_market::skills_market_open_dir,
            skills_market::skills_market_list,
            skills_market::skills_market_add,
            skills_market::skills_market_remove,
            skills_market::skills_market_sync,
            skills_market::skills_market_list_skills,
            skills_market::skills_market_detail,
            skills_market::skills_market_install,
            skills_market::skills_market_uninstall,
            notebook::notebook_list_documents,
            notebook::notebook_get_document,
            notebook::notebook_create_document,
            notebook::notebook_update_document,
            notebook::notebook_delete_document,
            notebook::notebook_list_all_documents,
            applets::applets_list,
            applets::applets_get,
            applets::applets_store_list_catalog,
            applets::applets_store_list_installed,
            applets::applets_store_install,
            applets::applets_store_uninstall,
            applets::applets_store_get_version,
            applets::applets_store_materialize_bundle,
            applets::applets_store_upload_audit,
            applets::applets_activate,
            applets::applets_deactivate,
            applets::applets_get_config,
            applets::applets_set_config,
            applets::applets_action,
            applets::applets_product_window_launch_context,
            applets::applets_product_window_report_rendered,
            applets::applets_product_window_report_lifecycle,
            applets::applets_readiness_probe_context,
            applets::applets_pick_import_directory,
            applets::applets_create_session,
            applets::applets_invoke,
            mcp::mcp_list_servers,
            mcp::mcp_get_server,
            mcp::mcp_create_server,
            mcp::mcp_update_server,
            mcp::mcp_delete_server,
            mcp::mcp_toggle_server,
            mcp::mcp_test_server,
            mcp::mcp_execute_tool,
            cron::cron_status,
            cron::cron_list_jobs,
            cron::cron_create_job,
            cron::cron_update_job,
            cron::cron_delete_job,
            cron::cron_toggle_job,
            cron::cron_run_job,
            cron::cron_list_runs,
            cron::cron_parse_schedule,
            model_config::model_config_list,
            model_config::model_config_get,
            model_config::model_config_set,
            model_config::model_config_delete,
            model_config::model_config_provider_references,
            channels::channels_list,
            channels::channels_get,
            channels::channels_create,
            channels::channels_update,
            channels::channels_delete,
            channels::channels_test,
            channels::channels_send,
            channels::channels_list_chats,
            channels::channels_start_bot,
            channels::channels_stop_bot,
            channels::channels_bot_status,
            channels::channels_list_events,
            channels::channels_stats,
            oauth2::oauth2_list_providers,
            oauth2::oauth2_get_provider,
            oauth2::oauth2_get_credential_info,
            oauth2::oauth2_set_credentials,
            oauth2::oauth2_authorize,
            oauth2::oauth2_handle_callback,
            oauth2::oauth2_list_connections,
            oauth2::oauth2_get_connection,
            oauth2::oauth2_disconnect,
            oauth2::oauth2_refresh_token,
            oauth2::oauth2_call_resource,
            oauth2::oauth2_reload,
            oauth2::oauth2_get_page,
            oauth2::oauth2_start_loopback,
            oauth2::oauth2_poll_loopback,
            account::account_list,
            account::account_get_active,
            account::account_switch,
            account::account_upsert_oauth,
            account::account_set_pin,
            account::account_unlock,
            account::account_relink_pin,
            account::account_list_restorable,
            account::account_clear_session,
            account::account_remove_pin,
            account::account_authorize_pin_recovery,
            account::account_begin_pin_recovery,
            account::account_reset_pin,
            account::account_get_device_id,
            presence::presence_notify,
            oss::oss_pick_local_file,
            oss::oss_pick_local_folder,
            oss::oss_upload_local_file,
            oss::oss_upload_agent_attachment_bytes,
            oss::oss_pick_image_social,
            oss::oss_upload_attachment_social,
            oss::oss_upload_encrypted_attachment_social,
            oss::oss_resolve_url,
            oss::oss_list_my_files,
            oss::oss_delete_file,
            oss::oss_restore_file,
            oss::oss_patch_file,
            oss::oss_invalidate_cache,
            memory::memory_list,
            memory::memory_get,
            memory::memory_delete,
            memory::memory_update,
            memory::memory_search,
            memory::memory_persona,
            memory::memory_stats,
            memory::memory_events,
            memory::memory_export,
            memory::memory_import,
            memory::memory_embedding_status,
            memory::memory_reembed,
            tts::tts_synthesize,
            tts::tts_voices,
            realtime::realtime_stream_start,
            realtime::realtime_stream_stop,
            realtime::realtime_signal_send,
            key_exchange::key_exchange_upload_bundle,
            key_exchange::key_exchange_fetch_bundle,
            crypto::crypto_generate_identity,
            crypto::crypto_get_identity,
            crypto::crypto_get_fingerprint,
            crypto::crypto_ratchet_telemetry_snapshot,
            crypto::crypto_generate_key_bundle,
            crypto::crypto_init_session,
            crypto::crypto_accept_session,
            crypto::crypto_session_status,
            crypto::crypto_mark_session_ready,
            crypto::crypto_list_sessions,
            crypto::crypto_list_sessions_for_peer,
            crypto::crypto_encrypt,
            crypto::crypto_decrypt,
            crypto::dr_encrypt,
            crypto::dr_decrypt,
            crypto::signaling_envelope_seal,
            crypto::signaling_envelope_open,
            messaging_recovery::messaging_recovery_generate_phrase,
            messaging_recovery::messaging_recovery_create_revision,
            messaging_recovery::messaging_recovery_restore_latest,
            messaging_recovery::messaging_recovery_status,
            messaging_recovery::messaging_recovery_list_revisions,
            ice::ice_get_servers,
            social::social_friend_request_send,
            social::social_friend_request_accept,
            social::social_friend_request_reject,
            social::social_friend_request_list,
            group_chat::group_chat_list_groups,
            group_chat::group_chat_list_messages,
            group_chat::group_chat_list_thread_messages,
            group_chat::group_chat_thread_counts,
            group_chat::group_chat_unread_count,
            group_chat::group_chat_mark_read,
            group_chat::group_chat_create_group,
            group_chat::group_chat_get_group,
            group_chat::group_chat_update_group,
            group_chat::group_chat_invite_to_group,
            group_chat::group_chat_add_federated_member,
            group_chat::group_chat_join_group,
            group_chat::group_chat_leave_group,
            group_chat::group_chat_get_members,
            group_chat::group_chat_remove_member,
            group_chat::group_chat_update_member,
            group_chat::group_chat_transfer_ownership,
            group_chat::group_chat_dissolve_group,
            group_chat::group_chat_recall_message,
            group_chat::group_chat_edit_message,
            group_chat::group_chat_delete_message,
            group_chat::group_chat_search_messages,
            group_chat::group_chat_update_nickname,
            group_chat::group_chat_get_settings,
            group_chat::group_chat_update_settings,
            group_chat::group_chat_get_offline_messages,
            group_chat::group_chat_ack_offline_messages,
            group_chat::group_chat_get_stats,
            group_chat::group_chat_local_search,
            group_chat::group_chat_local_search_scoped,
            group_chat::group_chat_set_cursor_scoped,
            group_chat::group_chat_get_cursor_scoped,
            group_chat::group_chat_get_key_version_scoped,
            group_chat::group_chat_rotate_key_scoped,
            group_chat::group_chat_sync_from_station_scoped,
            agent_growth::agent_growth_snapshot,
            agent_growth::agent_memory_list,
            agent_growth::agent_skill_list,
            agent_growth::agent_submit_feedback,
            agent_growth::agent_list_turn_feedback,
            agent_growth::agent_quick_completion,
            agent_scheduler::agent_scheduler_start,
            agent_scheduler::agent_scheduler_stop,
            agent_scheduler::agent_scheduler_status,
            agent_scheduler::agent_scheduler_add_job,
            notification::notification_list,
            notification::notification_unread_counts,
            notification::notification_mark_read,
            notification::notification_mark_all_read,
            notification::notification_delete,
            notification::notification_preferences,
            notification::notification_preferences_update,
            host_events::desktop_native_event_emit,
            station::station_list,
            station::station_set_active,
            station::station_binding_complete,
            station::station_add,
            station::station_remove,
            station::station_probe,
            messaging_commands::messaging_create_direct,
            messaging_commands::messaging_create_group,
            messaging_commands::messaging_membership_transition,
            messaging_commands::messaging_list_conversations,
            messaging_commands::messaging_pick_attachment_source,
            messaging_commands::messaging_stage_attachment_source,
            messaging_commands::messaging_discard_attachment_source,
            messaging_commands::messaging_capture_attachment_source,
            messaging_commands::messaging_send_message,
            messaging_commands::messaging_submit_typing,
            messaging_commands::messaging_submit_read_cursor,
            messaging_commands::messaging_submit_edit,
            messaging_commands::messaging_submit_metadata_interaction,
            messaging_commands::messaging_list_messages,
            messaging_commands::messaging_open_attachment,
            messaging_commands::messaging_search_messages,
            // v1 conversation commands (P2)
            conversation::conversation_create_direct,
            conversation::conversation_create_group,
            conversation::conversation_submit_command,
            conversation::conversation_submit_command_proposal,
            conversation::conversation_get_command_proposal_result,
            conversation::conversation_react,
            conversation::conversation_submit_receipt,
            conversation::conversation_list,
            conversation::conversation_list_events,
            conversation::conversation_get_members,
            conversation::conversation_list_messages,
            conversation::conversation_list_thread_messages,
            conversation::conversation_thread_counts,
            conversation::conversation_get_member_settings,
            conversation::conversation_update_member_settings,
            conversation::conversation_sync_from_station,
            conversation::envelope_submit,
            conversation::envelope_ack,
            conversation::envelope_resume,
            conversation::keypackage_upload,
            conversation::keypackage_fetch,
            conversation::keypackage_count,
            conversation::device_register,
            conversation::device_list,
            conversation::device_revoke,
            conversation::dkx_send,
            // v1 MLS group commands (P3)
            mls::mls_init_identity,
            mls::mls_submit_leave_intent,
            mls::mls_list_leave_intents,
            mls::mls_generate_key_package,
            mls::mls_group_create,
            mls::mls_group_join,
            mls::mls_group_encrypt,
            mls::mls_group_decrypt,
            mls::mls_group_process_commit,
            mls::mls_group_add_member,
            mls::mls_group_remove_member,
            mls::mls_group_remove_device,
            mls::mls_group_accept_pending,
            mls::mls_group_discard_pending,
            mls::mls_group_pending_status,
            mls::mls_recipient_record_authority_event,
            mls::mls_recipient_apply_delivery,
            mls::mls_recipient_status,
            mls::mls_group_public_head,
            mls::mls_group_save,
            mls::mls_group_load,
            application::error_resolver::resolve_error_action
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Closing the symmetric pair to AppLaunch (fired from the
            // frontend usePresence hook): when the user quits the app we
            // owe Station an explicit AppShutdown trigger per bound
            // actor, so its session is taken Offline immediately rather
            // than waiting for the client TCP to time out. We block on
            // the resulting reconcile threads so the network round-trip
            // has a chance to complete before the process exits — but
            // bound by a generous wall-clock budget so a wedged station
            // cannot prevent shutdown.
            if matches!(event, tauri::RunEvent::Resumed) {
                if let Err(error) = application::host_events::emit_resume(app, "tauri-run-event") {
                    let _ = application::host_events::emit_native_event_error(
                        app,
                        "emit-desktop-resume",
                        &error.to_string(),
                    );
                }
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                let capability_supervisor = app
                    .state::<Arc<application::desktop_executor_worker::CapabilityWorkerSupervisor>>();
                if let Err(error) = capability_supervisor.shutdown() {
                    tracing::warn!(
                        error = %error,
                        "client capability supervisor shutdown failed"
                    );
                }
                let state = app.state::<Arc<state::AppState>>();
                if let Err(error) = state.messaging_engines.deactivate_all() {
                    tracing::warn!(
                        error = %error,
                        "messaging: failed to stop all profile workers during shutdown"
                    );
                }
                let supervisor = app.state::<Arc<application::presence::PresenceSupervisor>>();
                let sessions = state.sessions.snapshot_all();
                tracing::info!(
                    bound_sessions = sessions.len(),
                    "presence: dispatching AppShutdown for bound actors"
                );
                let mut handles = Vec::new();
                for session in sessions {
                    if session.actor.actor_id.is_empty() || session.jwt.trim().is_empty() {
                        continue;
                    }
                    if let Some(h) = supervisor.notify(
                        &session.actor.actor_id,
                        &session.jwt,
                        domain::presence::PresenceTrigger::AppShutdown,
                        app.clone(),
                    ) {
                        handles.push(h);
                    }
                }
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                let mut pending = handles;
                while !pending.is_empty() && std::time::Instant::now() < deadline {
                    pending.retain(|h| !h.is_finished());
                    if !pending.is_empty() {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                }
                if !pending.is_empty() {
                    tracing::warn!(
                        remaining = pending.len(),
                        "presence: AppShutdown deadline reached, abandoning remaining reconciles"
                    );
                }
            }
        });
}
