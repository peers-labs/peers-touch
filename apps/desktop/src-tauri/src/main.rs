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
mod secure_content;
mod social;
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
    account, actor, admin, agent_events, agent_growth, agent_orchestration, agent_scheduler,
    agent_turn, agents, applets, auth, capability_authority, channels, conversation, cron, crypto,
    desktop_capture, evaluation, federation, frontend_log, frontend_telemetry, home, host_events,
    i18n, ice, key_exchange, mcp, memory, messaging as messaging_commands, messaging_recovery,
    model_config, notebook, notification, oauth2, oss, presence, profile, provider, realtime,
    runtime_evidence, search, settings, skills, skills_market, social as social_commands, station,
    system, tools, tts,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

const MESSAGING_PROJECTION_CHANGED_EVENT: &str = "messaging:projection-changed";

fn should_prevent_headless_browser_exit(client_surface: &str, exit_code: Option<i32>) -> bool {
    client_surface.trim().eq_ignore_ascii_case("browser") && exit_code.is_none()
}

#[cfg(all(feature = "acceptance-webdriver", target_os = "macos"))]
fn configure_acceptance_window_level(window: &tauri::WebviewWindow) -> std::io::Result<()> {
    use dispatch2::DispatchQueue;
    use objc2_app_kit::{NSScreenSaverWindowLevel, NSWindow, NSWindowCollectionBehavior};

    let ns_window = window.ns_window().map_err(|error| {
        std::io::Error::other(format!("acceptance native window lookup failed: {error}"))
    })? as usize;
    DispatchQueue::main().exec_async(move || {
        let ns_window = unsafe { &*(ns_window as *mut NSWindow) };
        let collection_behavior = ns_window.collectionBehavior()
            | NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        ns_window.setCollectionBehavior(collection_behavior);
        ns_window.setLevel(NSScreenSaverWindowLevel);
    });
    Ok(())
}

#[cfg(all(feature = "acceptance-webdriver", not(target_os = "macos")))]
fn configure_acceptance_window_level(_window: &tauri::WebviewWindow) -> std::io::Result<()> {
    Ok(())
}

#[cfg(all(feature = "acceptance-webdriver", target_os = "macos"))]
#[tauri::command]
fn acceptance_yield_activation(target_pid: i32) -> error::AppResult<serde_json::Value> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSRunningApplication};

    let Some(main_thread) = MainThreadMarker::new() else {
        return error::AppResult::fail(
            error::ErrorCode::InternalError,
            "acceptance activation yield must run on the AppKit main thread",
            Some(serde_json::json!({ "targetPid": target_pid })),
        );
    };
    let Some(target) = NSRunningApplication::runningApplicationWithProcessIdentifier(target_pid)
    else {
        return error::AppResult::fail(
            error::ErrorCode::NotFound,
            "acceptance activation target process is unavailable",
            Some(serde_json::json!({ "targetPid": target_pid })),
        );
    };

    NSApplication::sharedApplication(main_thread).yieldActivationToApplication(&target);
    error::AppResult::success(serde_json::json!({ "targetPid": target_pid }))
}

#[cfg(all(feature = "acceptance-webdriver", target_os = "macos"))]
#[tauri::command]
#[allow(deprecated)]
fn acceptance_request_activation() -> error::AppResult<serde_json::Value> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let Some(main_thread) = MainThreadMarker::new() else {
        return error::AppResult::fail(
            error::ErrorCode::InternalError,
            "acceptance activation request must run on the AppKit main thread",
            None,
        );
    };

    NSApplication::sharedApplication(main_thread).activateIgnoringOtherApps(true);
    error::AppResult::success(serde_json::json!({ "requested": true }))
}

#[cfg(feature = "acceptance-webdriver")]
fn acceptance_window_x(
    monitor_x: f64,
    monitor_width: f64,
    window_width: f64,
    slot: u32,
    count: u32,
) -> Option<f64> {
    if window_width > monitor_width {
        return None;
    }

    let available_span = monitor_width - window_width;
    let slot_ratio = if count <= 1 {
        0.0
    } else {
        f64::from(slot) / f64::from(count - 1)
    };
    Some(monitor_x + available_span * slot_ratio)
}

#[cfg(feature = "acceptance-webdriver")]
fn acceptance_window_inner_width(
    monitor_width: f64,
    outer_frame_width: f64,
    minimum_window_width: f64,
    count: u32,
) -> Option<f64> {
    if count == 0 {
        return None;
    }

    let maximum_inner_width = monitor_width - outer_frame_width.max(0.0);
    if minimum_window_width > maximum_inner_width {
        return None;
    }

    Some(
        (monitor_width / f64::from(count))
            .max(minimum_window_width)
            .min(maximum_inner_width),
    )
}

#[cfg(feature = "acceptance-webdriver")]
fn position_acceptance_window(
    window: &tauri::WebviewWindow,
    monitor_x: f64,
    monitor_width: f64,
    window_y: f64,
    scale: f64,
    slot: u32,
    count: u32,
) -> std::io::Result<()> {
    let actual_window_width = window
        .outer_size()
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window size lookup failed: {error}"))
        })?
        .to_logical::<f64>(scale)
        .width;
    let window_x = acceptance_window_x(monitor_x, monitor_width, actual_window_width, slot, count)
        .ok_or_else(|| {
            std::io::Error::other(format!(
                "acceptance window width {actual_window_width} exceeds monitor width {monitor_width}"
            ))
        })?;
    window
        .set_position(tauri::LogicalPosition::new(window_x, window_y))
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window positioning failed: {error}"))
        })
}

#[cfg(feature = "acceptance-webdriver")]
fn configure_acceptance_window(
    window: &tauri::WebviewWindow,
    minimum_window_width: f64,
) -> std::io::Result<()> {
    let slot = std::env::var("PT_ACCEPTANCE_WINDOW_SLOT")
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window slot is missing: {error}"))
        })?
        .parse::<u32>()
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window slot is invalid: {error}"))
        })?;
    let count = std::env::var("PT_ACCEPTANCE_WINDOW_COUNT")
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window count is missing: {error}"))
        })?
        .parse::<u32>()
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window count is invalid: {error}"))
        })?;
    if count == 0 || slot >= count {
        return Err(std::io::Error::other(format!(
            "acceptance window slot {slot} is outside window count {count}"
        )));
    }

    let monitor = window
        .current_monitor()
        .map_err(|error| {
            std::io::Error::other(format!("acceptance monitor lookup failed: {error}"))
        })?
        .ok_or_else(|| std::io::Error::other("acceptance window has no current monitor"))?;
    let scale = monitor.scale_factor();
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let logical_width = f64::from(monitor_size.width) / scale;
    let logical_height = f64::from(monitor_size.height) / scale;
    let logical_x = f64::from(monitor_position.x) / scale;
    let logical_y = f64::from(monitor_position.y) / scale;
    let initial_inner_width = window
        .inner_size()
        .map_err(|error| {
            std::io::Error::other(format!("acceptance client size lookup failed: {error}"))
        })?
        .to_logical::<f64>(scale)
        .width;
    let initial_outer_width = window
        .outer_size()
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window size lookup failed: {error}"))
        })?
        .to_logical::<f64>(scale)
        .width;
    let outer_frame_width = (initial_outer_width - initial_inner_width).max(0.0);
    let window_width = acceptance_window_inner_width(
        logical_width,
        outer_frame_width,
        minimum_window_width,
        count,
    )
    .ok_or_else(|| {
        std::io::Error::other(format!(
            "acceptance minimum client width {minimum_window_width} with outer frame width \
             {outer_frame_width} exceeds monitor width {logical_width}"
        ))
    })?;
    let window_height = (logical_height - 64.0).min(800.0);
    let window_y = logical_y + 32.0;

    window
        .set_position(tauri::LogicalPosition::new(logical_x, window_y))
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window positioning failed: {error}"))
        })?;
    let placement_started = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let positioned_window = window.clone();
    let expected_resize_width = window_width * scale;
    window.on_window_event(move |event| {
        let tauri::WindowEvent::Resized(size) = event else {
            return;
        };
        if (f64::from(size.width) - expected_resize_width).abs() > 1.0
            || placement_started.swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            return;
        }

        let positioned_window = positioned_window.clone();
        std::thread::spawn(move || {
            if let Err(error) = position_acceptance_window(
                &positioned_window,
                logical_x,
                logical_width,
                window_y,
                scale,
                slot,
                count,
            ) {
                tracing::error!(error = %error, "acceptance window placement failed");
            }
        });
    });
    window
        .set_size(tauri::LogicalSize::new(window_width, window_height))
        .map_err(|error| {
            std::io::Error::other(format!("acceptance window resize failed: {error}"))
        })?;
    position_acceptance_window(
        window,
        logical_x,
        logical_width,
        window_y,
        scale,
        slot,
        count,
    )?;
    window.show().map_err(|error| {
        std::io::Error::other(format!("acceptance window show failed: {error}"))
    })?;
    window.set_always_on_top(true).map_err(|error| {
        std::io::Error::other(format!("acceptance window layering failed: {error}"))
    })?;
    configure_acceptance_window_level(window)?;
    Ok(())
}

#[cfg(all(test, feature = "acceptance-webdriver"))]
mod acceptance_window_tests {
    use super::{acceptance_window_inner_width, acceptance_window_x};

    #[test]
    fn single_actor_client_width_reserves_native_window_frame() {
        let inner_width =
            acceptance_window_inner_width(1920.0, 16.0, 860.0, 1).expect("window should fit");

        assert_eq!(inner_width, 1904.0);
        assert!(inner_width + 16.0 <= 1920.0);
    }

    #[test]
    fn multi_actor_client_width_preserves_product_minimum() {
        let inner_width =
            acceptance_window_inner_width(1920.0, 16.0, 860.0, 3).expect("window should fit");

        assert_eq!(inner_width, 860.0);
        assert!(inner_width + 16.0 <= 1920.0);
    }

    #[test]
    fn minimum_client_width_wider_than_framed_monitor_fails_closed() {
        assert_eq!(acceptance_window_inner_width(800.0, 16.0, 790.0, 1), None);
    }

    #[test]
    fn three_actor_windows_stay_within_monitor_bounds() {
        let monitor_width = 1920.0;
        for (window_width, expected_positions) in [
            (860.0, vec![0.0, 530.0, 1060.0]),
            (862.0, vec![0.0, 529.0, 1058.0]),
        ] {
            let positions = (0..3)
                .map(|slot| {
                    acceptance_window_x(0.0, monitor_width, window_width, slot, 3)
                        .expect("window should fit")
                })
                .collect::<Vec<_>>();

            assert_eq!(positions, expected_positions);
            assert!(positions
                .iter()
                .all(|position| position + window_width <= monitor_width));
        }
    }

    #[test]
    fn single_actor_window_uses_monitor_origin() {
        assert_eq!(
            acceptance_window_x(320.0, 1920.0, 1200.0, 0, 1),
            Some(320.0)
        );
    }

    #[test]
    fn window_wider_than_monitor_fails_closed() {
        assert_eq!(acceptance_window_x(0.0, 800.0, 862.0, 0, 1), None);
    }
}

fn main() {
    let ctx = bootstrap::run();

    tracing::info!("Launching Tauri application");

    let app_state = Arc::new(ctx.app_state);
    let capability_worker_supervisor = Arc::new(
        application::desktop_executor_worker::CapabilityWorkerSupervisor::new(app_state.clone()),
    );

    let presence_supervisor = Arc::new(application::presence::PresenceSupervisor::new());

    let builder = tauri::Builder::default()
        .register_uri_scheme_protocol("private-media", |context, request| {
            if request.method() != tauri::http::Method::GET {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::METHOD_NOT_ALLOWED)
                    .body(Vec::new())
                    .expect("private media method response");
            }
            let grant_id = request
                .uri()
                .path()
                .trim_start_matches('/')
                .split('/')
                .next()
                .unwrap_or_default();
            if grant_id
                .parse::<ulid::Ulid>()
                .map(|value| value.to_string() != grant_id)
                .unwrap_or(true)
            {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::BAD_REQUEST)
                    .body(Vec::new())
                    .expect("private media bad-request response");
            }
            let state = context.app_handle().state::<Arc<state::AppState>>();
            match state
                .secure_content
                .read_private_media(context.webview_label(), grant_id)
            {
                Ok((bytes, media_type)) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::OK)
                    .header(tauri::http::header::CONTENT_TYPE, media_type)
                    .header(tauri::http::header::CACHE_CONTROL, "no-store")
                    .body(bytes)
                    .expect("private media response"),
                Err(_) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CACHE_CONTROL, "no-store")
                    .body(Vec::new())
                    .expect("private media not-found response"),
            }
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(desktop_capture::global_shortcut_plugin());

    #[cfg(feature = "acceptance-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(app_state)
        .manage(capability_worker_supervisor)
        .manage(desktop_capture::ChatScreenshotShortcutState::default())
        .manage(presence_supervisor)
        .setup(|app| {
            app.state::<Arc<state::AppState>>()
                .secure_content
                .bind_app_handle(app.handle().clone());
            #[cfg(feature = "acceptance-webdriver")]
            if std::env::var_os("PT_ACCEPTANCE_WINDOW_SLOT").is_some() {
                let minimum_window_width = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|config| config.label == "main")
                    .and_then(|config| config.min_width)
                    .unwrap_or_default();
                let window = app
                    .get_webview_window("main")
                    .ok_or_else(|| std::io::Error::other("acceptance main window is missing"))?;
                configure_acceptance_window(&window, minimum_window_width)?;
            }

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
                        "schemaVersion": 1,
                        "actorPtid": change.actor_ptid.clone(),
                        "homeStationPeerId": change.home_station_peer_id.clone(),
                        "deviceId": change.device_id.clone(),
                        "conversationId": change.conversation_id,
                        "eventId": change.event_id,
                        "laneSequence": change.lane_sequence.to_string(),
                        "kind": change.kind.as_str_name(),
                        "messageId": change.message_id,
                        "messageRemovedFromProjection": change.message_removed_from_projection,
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(all(feature = "acceptance-webdriver", target_os = "macos"))]
            acceptance_yield_activation,
            #[cfg(all(feature = "acceptance-webdriver", target_os = "macos"))]
            acceptance_request_activation,
            interface::tauri_commands::meta_contract_version,
            frontend_log::frontend_log,
            frontend_telemetry::frontend_telemetry_upload,
            i18n::i18n_load_resources,
            actor::actor_search_actors,
            actor::actor_get_my_profile,
            auth::access_start,
            auth::access_submit_invite_code,
            auth::access_submit_login,
            auth::access_decision,
            auth::access_cancel,
            auth::auth_logout,
            #[cfg(feature = "acceptance-webdriver")]
            auth::acceptance_logout_window_session,
            auth::auth_restore_session,
            auth::auth_validate_token,
            auth::ensure_station_session,
            settings::settings_get,
            settings::settings_set,
            settings::settings_reset,
            desktop_capture::chat_screenshot_shortcut_register,
            social_commands::social_create_moment,
            social_commands::social_get_moment,
            social_commands::social_delete_moment,
            social_commands::social_list_by_author,
            social_commands::social_get_timeline,
            social_commands::social_sync_moments_projection,
            social_commands::social_station_moderation_upsert,
            social_commands::social_station_moderation_delete,
            social_commands::social_station_moderation_list,
            social_commands::social_react,
            social_commands::social_unreact,
            social_commands::social_get_comments,
            social_commands::social_create_comment,
            social_commands::social_delete_comment,
            social_commands::social_follow,
            social_commands::social_unfollow,
            social_commands::social_get_followers,
            social_commands::social_get_following,
            social_commands::social_get_relationship,
            social_commands::social_block_actor,
            social_commands::social_unblock_actor,
            social_commands::social_circle_create,
            social_commands::social_circle_rename,
            social_commands::social_circle_delete,
            social_commands::social_circle_list_mine,
            social_commands::social_circle_add_members,
            social_commands::social_circle_remove_members,
            social_commands::social_circle_list_members,
            social_commands::social_get_my_stats,
            social::social_private_moments_bootstrap,
            social::social_private_moments_reconcile,
            social::social_private_moment_publish,
            social::social_private_moment_read,
            social::social_private_moment_media_open,
            social::social_private_moment_recover,
            social::social_private_moment_purge,
            social::social_private_moments_teardown,
            social::social_private_comments_bootstrap,
            social::social_private_comment_stage,
            social::social_private_comment_prepare,
            social::social_private_comment_submit,
            social::social_private_comments_list,
            #[cfg(feature = "acceptance-webdriver")]
            social::social_private_moments_acceptance_runtime_identity,
            #[cfg(feature = "acceptance-webdriver")]
            social::social_private_moments_acceptance_maintain_prekeys,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_recovery::messaging_recovery_acceptance_create_revision,
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
            provider::model_update,
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
            agents::agents_search,
            home::agent_home_projection_get,
            home::agent_home_chat_submit,
            home::agent_home_task_submit,
            home::agent_home_goal_draft_create,
            home::agent_home_goal_get,
            home::agent_home_goal_update,
            home::agent_home_goal_review,
            home::agent_home_goal_admit,
            home::agent_home_goal_start,
            evaluation::agent_evaluation_benchmark_create,
            evaluation::agent_evaluation_benchmark_update,
            evaluation::agent_evaluation_benchmark_delete,
            evaluation::agent_evaluation_benchmark_list,
            evaluation::agent_evaluation_dataset_create,
            evaluation::agent_evaluation_dataset_update,
            evaluation::agent_evaluation_dataset_delete,
            evaluation::agent_evaluation_dataset_list,
            evaluation::agent_evaluation_case_create,
            evaluation::agent_evaluation_case_update,
            evaluation::agent_evaluation_case_delete,
            evaluation::agent_evaluation_case_list,
            evaluation::agent_evaluation_run_create,
            evaluation::agent_evaluation_run_start,
            evaluation::agent_evaluation_run_cancel,
            evaluation::agent_evaluation_run_retry,
            evaluation::agent_evaluation_run_get,
            evaluation::agent_evaluation_run_list,
            evaluation::agent_evaluation_run_events_list,
            evaluation::agent_evaluation_run_delete,
            agent_turn::agent_execute_turn,
            agent_turn::agent_execute_turn_stream,
            agent_turn::agent_cancel_turn_stream,
            agent_turn::agent_disconnect_turn_stream,
            agent_turn::agent_cancel_turn,
            agent_turn::agent_replay_turn_stream,
            agent_turn::agent_cancel_turn_replay_stream,
            agent_turn::agent_turn_queue_list,
            agent_turn::agent_turn_queue_cancel,
            agent_turn::agent_turn_trace_list,
            agent_turn::agent_turn_trace_get,
            agent_turn::agent_turn_diagnostics_export,
            agent_turn::agent_submit_tool_decision,
            runtime_evidence::agent_runtime_profile_effective,
            capability_authority::agent_capability_manifest_list,
            capability_authority::agent_capability_binding_list,
            capability_authority::agent_capability_binding_upsert,
            capability_authority::agent_capability_binding_delete,
            capability_authority::agent_capability_readiness,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_prepare,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_arm,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_wait,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_release,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_clock_advance,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_interrupt,
            #[cfg(feature = "acceptance-webdriver")]
            capability_authority::agent_capability_acceptance_scenario_cleanup,
            capability_authority::agent_connector_manifest_list,
            capability_authority::agent_knowledge_descriptor_create,
            capability_authority::agent_knowledge_descriptor_update,
            capability_authority::agent_knowledge_descriptor_list,
            capability_authority::agent_knowledge_descriptor_tombstone,
            capability_authority::agent_package_export,
            capability_authority::agent_package_import,
            runtime_evidence::agent_capability_sessions,
            runtime_evidence::agent_browser_capability_session_open,
            runtime_evidence::agent_browser_capability_session_close,
            runtime_evidence::agent_client_executor_supervisor_start,
            runtime_evidence::agent_client_executor_supervisor_stop,
            runtime_evidence::agent_runtime_activity_station,
            runtime_evidence::agent_runtime_activity_local,
            runtime_evidence::agent_capability_session_snapshot,
            agent_turn::agent_conversation_list,
            agent_turn::agent_conversation_get,
            agent_turn::agent_conversation_create,
            agent_turn::agent_conversation_messages,
            agent_turn::agent_conversation_update,
            agent_turn::agent_conversation_archive,
            agent_turn::agent_conversation_restore,
            agent_turn::agent_conversation_runtime_reset,
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
            agent_events::agent_events_subscribe,
            agent_events::agent_events_cancel,
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
            mcp::mcp_refresh_server,
            mcp::agent_capability_operation_get,
            mcp::agent_capability_operation_cancel,
            mcp::agent_capability_operation_reconcile,
            mcp::agent_capability_operation_takeover,
            mcp::agent_capability_operation_cleanup_takeover,
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
            oauth2::oauth2_list_connections,
            oauth2::oauth2_sync_connector_manifests,
            oauth2::oauth2_get_connection,
            oauth2::oauth2_disconnect,
            oauth2::oauth2_refresh_token,
            oauth2::oauth2_call_resource,
            oauth2::oauth2_reload,
            oauth2::oauth2_get_page,
            oauth2::oauth2_start_loopback,
            oauth2::oauth2_poll_loopback,
            oauth2::oauth2_resume_loopback,
            oauth2::oauth2_cancel_loopback,
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
            presence::presence_query,
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
            realtime::realtime_call_resolution_get,
            realtime::realtime_signal_send,
            key_exchange::key_exchange_upload_bundle,
            key_exchange::key_exchange_fetch_bundle,
            crypto::crypto_ratchet_telemetry_snapshot,
            crypto::signaling_envelope_seal,
            crypto::signaling_envelope_open,
            messaging_recovery::messaging_recovery_generate_phrase,
            messaging_recovery::messaging_recovery_create_revision,
            messaging_recovery::messaging_recovery_restore_latest,
            messaging_recovery::messaging_recovery_status,
            messaging_recovery::messaging_recovery_list_revisions,
            ice::ice_get_servers,
            social_commands::social_friend_request_send,
            social_commands::social_friend_request_accept,
            social_commands::social_friend_request_reject,
            social_commands::social_friend_request_list,
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
            realtime::group_call_join,
            messaging_commands::messaging_create_direct,
            messaging_commands::messaging_create_group,
            messaging_commands::messaging_membership_transition,
            messaging_commands::messaging_update_conversation,
            messaging_commands::messaging_update_member_authority,
            messaging_commands::messaging_transfer_ownership,
            messaging_commands::messaging_dissolve_conversation,
            messaging_commands::messaging_leave_conversation,
            messaging_commands::messaging_submit_leave_intent,
            messaging_commands::messaging_list_leave_intents,
            messaging_commands::messaging_commit_authorized_leave,
            messaging_commands::messaging_list_conversations,
            messaging_commands::messaging_command_status,
            messaging_commands::chat_storage_snapshot,
            messaging_commands::chat_storage_clear_cache,
            messaging_commands::chat_storage_clear_conversation,
            messaging_commands::chat_storage_set_retention,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_commands::chat_storage_acceptance_seed_conversation_clear,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_commands::messaging_acceptance_current_endpoint,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_commands::messaging_acceptance_create_restorable_command,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_commands::messaging_acceptance_prepare_submitted_command,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_commands::messaging_acceptance_resume_lifecycle,
            #[cfg(feature = "acceptance-webdriver")]
            messaging_commands::messaging_acceptance_interaction_snapshot,
            messaging_commands::messaging_pick_attachment_source,
            messaging_commands::messaging_stage_attachment_source,
            messaging_commands::messaging_discard_attachment_source,
            messaging_commands::messaging_capture_attachment_source,
            messaging_commands::messaging_send_message,
            messaging_commands::messaging_retry_message,
            messaging_commands::messaging_submit_typing,
            messaging_commands::messaging_submit_read_cursor,
            messaging_commands::messaging_submit_edit,
            messaging_commands::messaging_submit_metadata_interaction,
            messaging_commands::messaging_list_messages,
            messaging_commands::messaging_list_thread_messages,
            messaging_commands::messaging_thread_counts,
            messaging_commands::messaging_get_member_settings,
            messaging_commands::messaging_update_member_settings,
            messaging_commands::messaging_open_attachment,
            messaging_commands::messaging_search_messages,
            // Conversation query and settings commands
            conversation::conversation_list_events,
            conversation::conversation_get_members,
            conversation::conversation_list_messages,
            conversation::conversation_list_thread_messages,
            conversation::conversation_sync_from_station,
            key_exchange::keypackage_upload,
            key_exchange::keypackage_fetch,
            key_exchange::keypackage_count,
            conversation::device_list,
            conversation::device_revoke,
            conversation::dkx_send,
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
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                let client_surface = std::env::var("PT_CLIENT_SURFACE").unwrap_or_default();
                if should_prevent_headless_browser_exit(&client_surface, *code) {
                    api.prevent_exit();
                    tracing::info!(
                        "prevented automatic exit for headless browser gateway"
                    );
                    return;
                }
                let capability_supervisor = app
                    .state::<Arc<application::desktop_executor_worker::CapabilityWorkerSupervisor>>();
                if let Err(error) = capability_supervisor.shutdown() {
                    tracing::warn!(
                        error = %error,
                        "client capability supervisor shutdown failed"
                    );
                }
                let state = app.state::<Arc<state::AppState>>();
                if let Err(error) = state.secure_content.shutdown() {
                    tracing::warn!(
                        error = %error,
                        "secure content supervisor shutdown failed"
                    );
                }
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
                    if session.actor.ptid.is_empty() || session.jwt.trim().is_empty() {
                        continue;
                    }
                    if let Some(h) = supervisor.notify(
                        &session.actor.ptid,
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

#[cfg(test)]
mod tests {
    use super::should_prevent_headless_browser_exit;

    #[test]
    fn headless_browser_prevents_only_automatic_exit() {
        assert!(should_prevent_headless_browser_exit("browser", None));
        assert!(should_prevent_headless_browser_exit(" Browser ", None));
        assert!(!should_prevent_headless_browser_exit("desktop", None));
        assert!(!should_prevent_headless_browser_exit("browser", Some(0)));
    }
}
