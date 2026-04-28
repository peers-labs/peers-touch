#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod bootstrap;
mod contracts;
mod domain;
mod error;
mod infrastructure;
mod interface;
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
    }
}

use std::sync::Arc;
use tauri::Manager;
use interface::tauri_commands::{account, actor, admin, agent_growth, agent_scheduler, agents, applets, auth, channels, chat, cron, crypto, friend_chat, frontend_log, group_chat, ice, i18n, mcp, memory, model_config, models, notebook, notification, oauth2, oss, presence, profile, provider, realtime, search, settings, skills, skills_market, system, timeline, tools, tts};

fn main() {
    let ctx = bootstrap::run();

    tracing::info!("Launching Tauri application");

    let app_state = Arc::new(ctx.app_state);

    #[cfg(debug_assertions)]
    interface::http_gateway::start(Arc::clone(&app_state));

    let presence_supervisor = Arc::new(application::presence::PresenceSupervisor::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .manage(app_state)
        .manage(presence_supervisor)
        .setup(|app| {
            let resource_dir = app.path()
                .resource_dir()
                .expect("[setup] Failed to resolve resource directory");
            let state = app.state::<Arc<state::AppState>>();
            if let Err(e) = state.i18n.deploy_builtin_packs(&resource_dir) {
                tracing::error!(error = %e, "Failed to deploy built-in i18n packs");
            }

            // Allow the asset:// protocol to read locally cached avatar files.
            // Tauri 2 disables asset:// by default; the static scope in
            // capabilities/default.json grants the permission, this call
            // restricts the readable filesystem area to just the avatar cache.
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
            if let Err(e) = infrastructure::session_store::migrate_legacy() {
                tracing::warn!(error = %e, "session_store: migrate_legacy failed (continuing boot)");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            interface::tauri_commands::meta_contract_version,
            frontend_log::frontend_log,
            i18n::i18n_load_resources,
            actor::actor_search_actors,
            actor::actor_get_my_profile,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_restore_session,
            auth::auth_validate_token,
            auth::ensure_station_session,
            settings::settings_get,
            settings::settings_set,
            settings::settings_reset,
            chat::chat_list_conversations,
            chat::chat_list_messages,
            chat::chat_send_message,
            chat::chat_mark_read,
            chat::chat_delete_conversation,
            chat::chat_rename_conversation,
            chat::chat_duplicate_conversation,
            chat::chat_smart_rename_conversation,
            chat::chat_set_conversation_model,
            chat::chat_delete_message,
            chat::chat_update_message,
            chat::chat_stop,
            chat::chat_completion_once,
            timeline::timeline_list,
            timeline::timeline_like,
            timeline::timeline_comment,
            timeline::timeline_repost,
            profile::profile_get,
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
            models::model_add,
            models::model_update,
            models::model_delete,
            models::model_fetch_remote,
            models::model_toggle,
            models::model_toggle_all,
            agents::agents_list,
            agents::agents_get,
            agents::agents_create,
            agents::agents_update,
            agents::agents_delete,
            agents::agents_duplicate,
            agents::agents_search,
            agents::agents_list_sessions,
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
            skills_market::skills_import_url,
            skills_market::skills_import_github,
            skills_market::skills_market_dir,
            skills_market::skills_market_open_dir,
            skills_market::skills_market_list,
            skills_market::skills_market_add,
            skills_market::skills_market_remove,
            skills_market::skills_market_sync,
            skills_market::skills_market_list_skills,
            skills_market::skills_market_detail,
            skills_market::skills_market_install,
            notebook::notebook_list_documents,
            notebook::notebook_get_document,
            notebook::notebook_create_document,
            notebook::notebook_update_document,
            notebook::notebook_delete_document,
            notebook::notebook_list_all_documents,
            applets::applets_list,
            applets::applets_get,
            applets::applets_activate,
            applets::applets_deactivate,
            applets::applets_get_config,
            applets::applets_set_config,
            applets::applets_action,
            applets::applets_invoke,
            mcp::mcp_list_servers,
            mcp::mcp_get_server,
            mcp::mcp_create_server,
            mcp::mcp_update_server,
            mcp::mcp_delete_server,
            mcp::mcp_toggle_server,
            mcp::mcp_test_server,
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
            account::account_list_restorable,
            account::account_clear_session,
            account::account_remove_pin,
            presence::presence_notify,
            oss::pick_chat_attachment,
            oss::chat_upload_attachment,
            oss::oss_resolve_url,
            oss::oss_list_my_files,
            oss::oss_delete_file,
            oss::oss_restore_file,
            oss::oss_patch_file,
            oss::oss_invalidate_cache,
            memory::memory_list,
            memory::memory_get,
            memory::memory_delete,
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
            friend_chat::friend_chat_list_sessions,
            friend_chat::friend_chat_create_session,
            friend_chat::friend_chat_list_messages,
            friend_chat::friend_chat_send_message,
            friend_chat::friend_chat_ack_messages,
            friend_chat::friend_chat_recall_message,
            friend_chat::friend_chat_edit_message,
            friend_chat::friend_chat_delete_message,
            friend_chat::friend_chat_sync_messages,
            friend_chat::friend_chat_go_online,
            friend_chat::friend_chat_go_offline,
            friend_chat::friend_chat_presence_start,
            friend_chat::friend_chat_presence_stop,
            realtime::realtime_stream_start,
            realtime::realtime_stream_stop,
            realtime::realtime_signal_send,
            realtime::realtime_typing_send,
            friend_chat::friend_chat_get_pending,
            friend_chat::friend_chat_get_stats,
            friend_chat::friend_chat_local_search,
            crypto::chat_search_local,
            crypto::signaling_envelope_seal,
            crypto::signaling_envelope_open,
            friend_chat::friend_chat_local_search_scoped,
            friend_chat::friend_chat_set_cursor_scoped,
            friend_chat::friend_chat_get_cursor_scoped,
            friend_chat::friend_chat_get_key_version_scoped,
            friend_chat::friend_chat_rotate_key_scoped,
            friend_chat::friend_chat_sync_from_station_scoped,
            ice::ice_get_servers,
            friend_chat::friend_chat_send_friend_request,
            friend_chat::friend_chat_accept_friend_request,
            friend_chat::friend_chat_reject_friend_request,
            friend_chat::friend_chat_list_friend_requests,
            group_chat::group_chat_list_groups,
            group_chat::group_chat_list_messages,
            group_chat::group_chat_send_message,
            group_chat::group_chat_unread_count,
            group_chat::group_chat_mark_read,
            group_chat::group_chat_create_group,
            group_chat::group_chat_get_group,
            group_chat::group_chat_update_group,
            group_chat::group_chat_invite_to_group,
            group_chat::group_chat_join_group,
            group_chat::group_chat_leave_group,
            group_chat::group_chat_get_members,
            group_chat::group_chat_remove_member,
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
            notification::notification_preferences_update
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
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                let state = app.state::<Arc<state::AppState>>();
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
