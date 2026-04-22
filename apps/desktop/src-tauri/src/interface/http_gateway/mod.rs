// HTTP Gateway for dev-mode frontend invocations.
//
// Replaces tauri-plugin-dev-invoke with a multi-threaded HTTP server
// powered by tiny_http + threadpool, listening on 127.0.0.1:3030.
//
// Protocol: POST JSON { "cmd": "<command_name>", "args": { ... } }
// Response: JSON serialization of the command's return value.
//
// 2026-04-09: Initial creation. Full 1:1 mapping of all 237 tauri commands.

use std::io::Read as _;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::contracts::*;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::resolve_user_scope;
use crate::state::AppState;

// -------------------------------------------------------------------------
// Application layer imports (mirrors tauri_commands structure)
// -------------------------------------------------------------------------
use crate::application::account as app_account;
use crate::application::admin as app_admin;
use crate::application::agents as app_agents;
use crate::application::applets as app_applets;
use crate::application::auth::service as app_auth;
use crate::application::channels as app_channels;
use crate::application::chat as app_chat;
use crate::application::chat_storage;
use crate::application::cron as app_cron;
use crate::application::mcp as app_mcp;
use crate::application::memory as app_memory;
use crate::application::model_config as app_model_config;
use crate::application::models as app_models;
use crate::application::notebook as app_notebook;
use crate::application::oauth2 as app_oauth2;
use crate::application::profile as app_profile;
use crate::application::provider as app_provider;
use crate::application::search as app_search;
use crate::application::settings as app_settings;
use crate::application::skills as app_skills;
use crate::application::skills_market as app_skills_market;
use crate::application::system as app_system;
use crate::application::timeline as app_timeline;
use crate::application::tools as app_tools;
use crate::application::tts as app_tts;

// Actor & chat modules use station_client + proto directly
use crate::infrastructure::station_client;
use crate::model;
use reqwest::blocking::Client;
use reqwest::Method;

const DEFAULT_PORT: u16 = 3030;
const POOL_SIZE: usize = 8;

fn resolve_bind_addr() -> String {
    let port = std::env::var("PT_GATEWAY_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    format!("127.0.0.1:{}", port)
}

/// Spawn a background thread that runs the HTTP gateway server.
///
/// The server listens on the port specified by PT_GATEWAY_PORT env var
/// (default 3030) and dispatches incoming POST requests to the same
/// application-layer functions used by tauri_commands.
pub fn start(state: Arc<AppState>) {
    std::thread::Builder::new()
        .name("http-gateway".into())
        .spawn(move || {
            let bind_addr = resolve_bind_addr();
            let server = match tiny_http::Server::http(&bind_addr) {
                Ok(s) => {
                    tracing::info!(addr = %bind_addr, "HTTP gateway started");
                    s
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to start HTTP gateway");
                    return;
                }
            };

            let pool = threadpool::ThreadPool::new(POOL_SIZE);
            let server = Arc::new(server);

            loop {
                let request = match server.recv() {
                    Ok(req) => req,
                    Err(e) => {
                        tracing::warn!(error = %e, "HTTP gateway recv error");
                        continue;
                    }
                };

                let state = Arc::clone(&state);
                pool.execute(move || {
                    handle_request(request, &state);
                });
            }
        })
        .expect("[http_gateway] Failed to spawn server thread");
}

// -------------------------------------------------------------------------
// Request handling
// -------------------------------------------------------------------------

fn handle_request(mut request: tiny_http::Request, state: &AppState) {
    // CORS preflight
    if *request.method() == tiny_http::Method::Options {
        let response = tiny_http::Response::empty(200)
            .with_header(cors_origin())
            .with_header(cors_methods())
            .with_header(cors_headers());
        let _ = request.respond(response);
        return;
    }

    // Only accept POST
    if request.method() != &tiny_http::Method::Post {
        let body = json!({"ok": false, "error": "method not allowed"}).to_string();
        let response = tiny_http::Response::from_string(body)
            .with_status_code(405)
            .with_header(content_type_json())
            .with_header(cors_origin());
        let _ = request.respond(response);
        return;
    }

    // Read body
    let mut body = String::new();
    if let Err(e) = request.as_reader().read_to_string(&mut body) {
        let err = json!({"ok": false, "error": format!("read body failed: {e}")}).to_string();
        let response = tiny_http::Response::from_string(err)
            .with_status_code(400)
            .with_header(content_type_json())
            .with_header(cors_origin());
        let _ = request.respond(response);
        return;
    }

    // Parse { cmd, args }
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            let err = json!({"ok": false, "error": format!("invalid json: {e}")}).to_string();
            let response = tiny_http::Response::from_string(err)
                .with_status_code(400)
                .with_header(content_type_json())
                .with_header(cors_origin());
            let _ = request.respond(response);
            return;
        }
    };

    let cmd = parsed.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
    let raw_args = parsed.get("args").cloned().unwrap_or(json!({}));

    // Tauri invoke wraps command params as { "input": <actual_data> }.
    // Frontend's invokeRustCommand calls invoke(cmd, { input }) so the
    // gateway always receives { "input": ... }. Unwrap that envelope
    // so dispatch functions receive the inner payload directly.
    let args = match raw_args.get("input") {
        Some(inner) => inner.clone(),
        None => raw_args,
    };

    let result = dispatch(cmd, args, state);

    let response_body = result.to_string();
    let response = tiny_http::Response::from_string(response_body)
        .with_status_code(200)
        .with_header(content_type_json())
        .with_header(cors_origin());
    let _ = request.respond(response);
}

// -------------------------------------------------------------------------
// CORS & Content-Type helpers
// -------------------------------------------------------------------------

fn cors_origin() -> tiny_http::Header {
    "Access-Control-Allow-Origin: *".parse().unwrap()
}

fn cors_methods() -> tiny_http::Header {
    "Access-Control-Allow-Methods: POST, OPTIONS".parse().unwrap()
}

fn cors_headers() -> tiny_http::Header {
    "Access-Control-Allow-Headers: Content-Type".parse().unwrap()
}

fn content_type_json() -> tiny_http::Header {
    "Content-Type: application/json; charset=utf-8".parse().unwrap()
}

// -------------------------------------------------------------------------
// State extraction helpers (equivalent to tauri_commands helpers)
// -------------------------------------------------------------------------

fn token_from_state(state: &AppState) -> Result<String, Value> {
    let guard = state.session.lock().map_err(|_| {
        serde_json::to_value(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError, "failed to access session state", None,
        )).unwrap_or(json!({"ok": false}))
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(serde_json::to_value(AppResult::<StubPayload>::fail(
            ErrorCode::Unauthorized, "authentication required", None,
        )).unwrap_or(json!({"ok": false})));
    }
    Ok(token)
}

fn actor_id_from_state(state: &AppState) -> Option<String> {
    state.session.lock().ok().and_then(|g| g.actor_id.clone())
}

fn user_scope_from_state(state: &AppState) -> String {
    let actor_id = actor_id_from_state(state);
    resolve_user_scope(actor_id.as_deref())
}

fn resolve_scope(state: &AppState) -> Result<Option<String>, Value> {
    let guard = state.session.lock().map_err(|_| {
        serde_json::to_value(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError, "failed to access session state", None,
        )).unwrap_or(json!({"ok": false}))
    })?;
    let scope = guard.actor_id.clone().unwrap_or_default();
    let scope = scope.trim();
    if scope.is_empty() {
        return Ok(None);
    }
    Ok(Some(scope.to_string()))
}

/// Convenience: serialize any AppResult<T: Serialize> to Value.
fn to_json<T: serde::Serialize>(r: AppResult<T>) -> Value {
    serde_json::to_value(r).unwrap_or(json!({"ok": false, "error": {"code": "INTERNAL_ERROR", "message": "serialization failed"}}))
}

/// Deserialize args into T, returning a JSON error Value on failure.
fn parse_args<T: serde::de::DeserializeOwned>(args: Value) -> Result<T, Value> {
    serde_json::from_value(args).map_err(|e| {
        to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            format!("invalid args: {e}"),
            None,
        ))
    })
}

// -------------------------------------------------------------------------
// Station HTTP helpers (mirrors group_chat.rs / friend_chat.rs)
// -------------------------------------------------------------------------

fn station_request_json(
    method: Method, path: &str, token: &str,
    query: Option<&[(&str, String)]>, body: Option<Value>,
) -> Result<Value, Value> {
    let client = Client::builder().build().map_err(|e| {
        to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError, "failed to create http client",
            Some(json!({"reason": e.to_string()})),
        ))
    })?;

    let mut req = client
        .request(method, format!("{}{}", station_client::station_base_url(), path))
        .bearer_auth(token);
    if let Some(q) = query { req = req.query(q); }
    if let Some(b) = body {
        req = req
            .header("Content-Type", "application/json")
            .json(&b);
    } else {
        req = req.header("Content-Type", "application/json");
    }
    req = req.header("Accept", "application/json");

    let response = req.send().map_err(|e| {
        to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError, "station request failed",
            Some(json!({"reason": e.to_string()})),
        ))
    })?;

    if !response.status().is_success() {
        let code = match response.status().as_u16() {
            400 => ErrorCode::InvalidArgument,
            401 => ErrorCode::Unauthorized,
            403 => ErrorCode::Forbidden,
            404 => ErrorCode::NotFound,
            409 => ErrorCode::Conflict,
            _   => ErrorCode::InternalError,
        };
        return Err(to_json(AppResult::<StubPayload>::fail(
            code, "station request failed",
            Some(json!({"status": response.status().as_u16()})),
        )));
    }

    response.json::<Value>().map_err(|e| {
        to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError, "invalid station response",
            Some(json!({"reason": e.to_string()})),
        ))
    })
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn extract_latest_ulid(payload: &Value) -> Option<String> {
    payload.get("messages")?.as_array()?.iter()
        .find_map(|item| item.get("ulid").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string()))
}

fn filter_incremental_messages(payload: &Value, cursor: Option<&str>) -> (Value, usize, Option<String>) {
    let mut filtered = payload.clone();
    let mut count = 0usize;
    let mut latest: Option<String> = None;
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        let mut out = Vec::new();
        for item in messages {
            let ulid = item.get("ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            if ulid.is_empty() { continue; }
            let keep = match cursor {
                Some(c) if !c.trim().is_empty() => ulid.as_str() > c,
                _ => true,
            };
            if keep {
                count += 1;
                if latest.as_ref().map(|v| ulid.as_str() > v.as_str()).unwrap_or(true) {
                    latest = Some(ulid.clone());
                }
                out.push(item.clone());
            }
        }
        if let Some(obj) = filtered.as_object_mut() {
            obj.insert("messages".to_string(), Value::Array(out));
        }
    }
    (filtered, count, latest)
}

// -------------------------------------------------------------------------
// Command dispatch - maps cmd string to application-layer calls
// -------------------------------------------------------------------------

/// Dispatch a command by name, returning the result as a JSON Value.
///
/// This function mirrors the full invoke_handler list from main.rs,
/// calling the same application-layer functions that tauri_commands use.
fn dispatch(cmd: &str, args: Value, state: &AppState) -> Value {
    match cmd {
        // =================================================================
        // Meta
        // =================================================================
        "meta_contract_version" => {
            to_json(AppResult::success(StubPayload {
                command: "meta_contract_version".to_string(),
                status: json!({"version": CONTRACT_VERSION}).to_string(),
            }))
        }

        // =================================================================
        // Frontend log (fire-and-forget, always succeeds)
        // =================================================================
        "frontend_log" => {
            if let Ok(input) = parse_args::<FrontendLogInput>(args) {
                let data_str = input.data.as_deref().unwrap_or("");
                match input.level.as_str() {
                    "error" => tracing::error!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
                    "warn"  => tracing::warn!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
                    "debug" => tracing::debug!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
                    _       => tracing::info!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
                }
            }
            json!(null)
        }

        // =================================================================
        // I18n (returns AppResult<I18nResources>, not StubPayload)
        // =================================================================
        "i18n_load_resources" => {
            match state.i18n.load_resources() {
                Ok(resources) => to_json(AppResult::success(resources)),
                Err(e) => {
                    tracing::error!(error = %e, "Failed to load i18n resources");
                    to_json(AppResult::<crate::infrastructure::i18n::I18nResources>::fail(
                        ErrorCode::InternalError,
                        format!("Failed to load i18n resources: {}", e),
                        None,
                    ))
                }
            }
        }

        // =================================================================
        // Actor (state-dependent, proto-based)
        // =================================================================
        "actor_search_actors" => {
            let input = match parse_args::<ActorSearchUsersInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let resp = match station_client::request_proto::<(), model::actor::ActorList>(
                Method::GET, "/api/v1/social/users/search", &token, Some(&[("q", input.q.clone())]), None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
            };
            let items: Vec<Value> = resp.items.iter().map(|a| json!({
                "id": a.id, "username": a.username, "displayName": a.display_name,
                "email": a.email, "actorId": a.actor_id, "avatar": a.avatar,
            })).collect();
            to_json(to_stub("actor_search_actors", json!({"items": items, "total": resp.total})))
        }

        "actor_get_my_profile" => {
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let resp = match station_client::request_proto::<(), model::actor::ActorProfile>(
                Method::GET, "/api/v1/social/users/me", &token, None, None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
            };
            to_json(to_stub("actor_get_my_profile", json!({
                "id": resp.id, "displayName": resp.display_name,
                "username": resp.username, "avatar": resp.avatar,
            })))
        }

        // =================================================================
        // Auth (state-dependent)
        // =================================================================
        "auth_login" => {
            let input = match parse_args::<AuthLoginInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_auth::auth_login(input, state))
        }
        "auth_logout" => to_json(app_auth::auth_logout(state)),
        "auth_restore_session" => to_json(app_auth::auth_restore_session(state)),
        "auth_validate_token" => {
            let input = match parse_args::<AuthValidateTokenInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_auth::auth_validate_token(input, state))
        }
        "ensure_station_session" => to_json(app_auth::ensure_station_session(state)),

        // =================================================================
        // Settings (state-dependent)
        // =================================================================
        "settings_get" => {
            let input = match parse_args::<SettingsGetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_settings::settings_get(state, input))
        }
        "settings_set" => {
            let input = match parse_args::<SettingsSetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_settings::settings_set(state, input))
        }
        "settings_reset" => to_json(app_settings::settings_reset(state)),

        // =================================================================
        // Chat (no state)
        // =================================================================
        "chat_list_conversations" => to_json(app_chat::chat_list_conversations()),
        "chat_list_messages" => {
            let input = match parse_args::<ChatListMessagesInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_list_messages(input))
        }
        "chat_send_message" => {
            let input = match parse_args::<ChatSendMessageInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_send_message(input))
        }
        "chat_mark_read" => {
            let input = match parse_args::<ChatMarkReadInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_mark_read(input))
        }
        "chat_delete_conversation" => {
            let input = match parse_args::<ChatConversationInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_delete_conversation(input))
        }
        "chat_rename_conversation" => {
            let input = match parse_args::<ChatRenameConversationInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_rename_conversation(input))
        }
        "chat_duplicate_conversation" => {
            let input = match parse_args::<ChatConversationInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_duplicate_conversation(input))
        }
        "chat_smart_rename_conversation" => {
            let input = match parse_args::<ChatConversationInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_smart_rename_conversation(input))
        }
        "chat_set_conversation_model" => {
            let input = match parse_args::<ChatSetConversationModelInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_set_conversation_model(input))
        }
        "chat_delete_message" => {
            let input = match parse_args::<ChatMessageInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_delete_message(input))
        }
        "chat_update_message" => {
            let input = match parse_args::<ChatUpdateMessageInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_update_message(input))
        }
        "chat_stop" => {
            let input = match parse_args::<ChatConversationInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_stop(input))
        }
        // chat_completion_once: blocking call (originally async in tauri, runs sync here)
        "chat_completion_once" => {
            let input = match parse_args::<ChatCompletionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_chat::chat_completion_once(input))
        }

        // =================================================================
        // Timeline (no state)
        // =================================================================
        "timeline_list" => {
            let input = match parse_args::<TimelineListInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_timeline::timeline_list(input))
        }
        "timeline_like" => {
            let input = match parse_args::<TimelineActionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_timeline::timeline_like(input))
        }
        "timeline_comment" => {
            let input = match parse_args::<TimelineActionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_timeline::timeline_comment(input))
        }
        "timeline_repost" => {
            let input = match parse_args::<TimelineActionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_timeline::timeline_repost(input))
        }

        // =================================================================
        // Profile (no state)
        // =================================================================
        "profile_get" => to_json(app_profile::profile_get(state)),
        "profile_update" => {
            let input = match parse_args::<ProfileUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_profile::profile_update(state, input))
        }
        "profile_upload_avatar" => {
            let input = match parse_args::<FileUploadInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_profile::profile_upload_avatar(input))
        }
        "profile_upload_header" => {
            let input = match parse_args::<FileUploadInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_profile::profile_upload_header(input))
        }
        "profile_update_privacy" => {
            let input = match parse_args::<ProfilePrivacyInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_profile::profile_update_privacy(input))
        }
        "profile_upload_avatar_oss" => {
            let input = match parse_args::<FileUploadInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_profile::profile_upload_avatar_oss(state, input))
        }
        "profile_upload_header_oss" => {
            let input = match parse_args::<FileUploadInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_profile::profile_upload_header_oss(state, input))
        }
        "pick_image_file" => {
            let dialog = rfd::FileDialog::new()
                .set_title("Select Image")
                .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"]);
            match dialog.pick_file() {
                Some(path) => to_json(AppResult::success(StubPayload {
                    command: "pick_image_file".to_string(),
                    status: path.to_string_lossy().to_string(),
                })),
                None => to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "no file selected", None)),
            }
        }
        "account_sync_avatar" => {
            let input = match parse_args::<crate::contracts::AccountSyncAvatarInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.avatar_url.is_empty() {
                to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "avatar_url is required", None))
            } else {
                match crate::application::profile::sync_avatar_with_download(&input.avatar_url) {
                    Ok(local_path) => {
                        let status = match local_path {
                            Some(p) => format!("synced_local:{}", p),
                            None => "synced_remote_only".to_string(),
                        };
                        to_json(AppResult::success(StubPayload {
                            command: "account_sync_avatar".to_string(),
                            status,
                        }))
                    }
                    Err(e) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
                }
            }
        }
        "sync_user_profile" => {
            to_json(crate::application::profile::sync_user_profile(&state))
        }

        // =================================================================
        // Admin (state-dependent)
        // =================================================================
        "admin_health" => to_json(app_admin::admin_health(state)),
        "admin_network_probe" => {
            let input = match parse_args::<AdminNetworkProbeInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_admin::admin_network_probe(state, input))
        }
        "admin_execute_action" => {
            let input = match parse_args::<AdminExecuteActionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_admin::admin_execute_action(state, input))
        }

        // =================================================================
        // Provider (state-dependent via scope)
        // =================================================================
        "provider_list" => {
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_list(scope.as_deref()))
        }
        "provider_get" => {
            let input = match parse_args::<ProviderIdInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_get(scope.as_deref(), input))
        }
        "provider_update" => {
            let input = match parse_args::<ProviderUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_update(scope.as_deref(), input))
        }
        "provider_check" => {
            let input = match parse_args::<ProviderCheckInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_check(scope.as_deref(), input))
        }
        "provider_create" => {
            let input = match parse_args::<ProviderCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_create(scope.as_deref(), input))
        }
        "provider_delete" => {
            let input = match parse_args::<ProviderIdInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_delete(scope.as_deref(), input))
        }
        "provider_apply_preset" => {
            let input = match parse_args::<ProviderIdInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_apply_preset(scope.as_deref(), input))
        }
        "provider_list_available_models" => {
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_provider::provider_list_available_models(scope.as_deref()))
        }

        // =================================================================
        // Models (state-dependent via scope)
        // =================================================================
        "model_add" => {
            let input = match parse_args::<ProviderModelAddInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_models::model_add(scope.as_deref(), input))
        }
        "model_update" => {
            let input = match parse_args::<ProviderModelUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_models::model_update(scope.as_deref(), input))
        }
        "model_delete" => {
            let input = match parse_args::<ProviderModelDeleteInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_models::model_delete(scope.as_deref(), input))
        }
        "model_fetch_remote" => {
            let input = match parse_args::<ProviderModelFetchInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_models::model_fetch_remote(scope.as_deref(), input))
        }
        "model_toggle" => {
            let input = match parse_args::<ProviderModelToggleInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_models::model_toggle(scope.as_deref(), input))
        }
        "model_toggle_all" => {
            let input = match parse_args::<ProviderModelToggleAllInput>(args) { Ok(v) => v, Err(e) => return e };
            let scope = match resolve_scope(state) { Ok(s) => s, Err(e) => return e };
            to_json(app_models::model_toggle_all(scope.as_deref(), input))
        }

        // =================================================================
        // Agents (no state)
        // =================================================================
        "agents_list" => to_json(app_agents::agents_list()),
        "agents_get" => {
            let input = match parse_args::<AgentIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_get(input))
        }
        "agents_create" => {
            let input = match parse_args::<AgentCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_create(input))
        }
        "agents_update" => {
            let input = match parse_args::<AgentUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_update(input))
        }
        "agents_delete" => {
            let input = match parse_args::<AgentIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_delete(input))
        }
        "agents_duplicate" => {
            let input = match parse_args::<AgentDuplicateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_duplicate(input))
        }
        "agents_search" => {
            let input = match parse_args::<AgentSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_search(input))
        }
        "agents_list_sessions" => {
            let input = match parse_args::<AgentIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_agents::agents_list_sessions(input))
        }

        // =================================================================
        // Tools (no state)
        // =================================================================
        "tools_list" => to_json(app_tools::tools_list()),
        "tools_search_providers" => to_json(app_tools::tools_search_providers()),
        "tools_set_search_primary" => {
            let input = match parse_args::<SearchPrimaryInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_tools::tools_set_search_primary(input))
        }

        // =================================================================
        // Search (no state)
        // =================================================================
        "help_get" => to_json(app_search::help_get()),
        "search_sources" => to_json(app_search::search_sources()),
        "search_query" => {
            let input = match parse_args::<SearchQueryInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_search::search_query(input))
        }
        "search_ai" => {
            let input = match parse_args::<AiSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_search::search_ai(input))
        }

        // =================================================================
        // System (no state)
        // =================================================================
        "system_health" => to_json(app_system::system_health()),
        "open_external_url" => {
            let input = match parse_args::<ExternalUrlInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::open_external_url(input))
        }
        "onboarding_reset" => to_json(app_system::onboarding_reset()),
        "statistics_get" => to_json(app_system::statistics_get()),
        "preferences_get" => to_json(app_system::preferences_get()),
        "preferences_set" => {
            let input = match parse_args::<PreferencesSetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::preferences_set(input))
        }
        "share_create" => {
            let input = match parse_args::<ShareSessionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::share_create(input))
        }
        "share_delete" => {
            let input = match parse_args::<ShareSessionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::share_delete(input))
        }
        "share_get" => {
            let input = match parse_args::<ShareIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::share_get(input))
        }
        "logs_tail" => {
            let input = match parse_args::<LogsTailInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::logs_tail(input))
        }
        "oauth_simulate_lark_start" => {
            let input = match parse_args::<OAuthSimulateStartInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::oauth_simulate_lark_start(input))
        }
        "oauth_simulate_lark_poll" => {
            let input = match parse_args::<OAuthSessionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::oauth_simulate_lark_poll(input))
        }
        "oauth_simulate_lark_create_bot_session" => {
            let input = match parse_args::<OAuthCreateBotSessionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::oauth_simulate_lark_create_bot_session(input))
        }
        "config_section_get" => {
            let input = match parse_args::<ConfigSectionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::config_section_get(input))
        }
        "config_section_set" => {
            let input = match parse_args::<ConfigSectionSetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::config_section_set(input))
        }
        "config_field_reset" => {
            let input = match parse_args::<ConfigFieldResetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::config_field_reset(input))
        }
        "config_test_postgres" => {
            let input = match parse_args::<ConfigPostgresTestInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::config_test_postgres(input))
        }
        "embedding_models_list" => to_json(app_system::embedding_models_list()),
        "visitor_heartbeat" => to_json(app_system::visitor_heartbeat()),
        "visitor_online" => to_json(app_system::visitor_online()),
        "context_snapshot_get" => {
            let input: Option<ContextSnapshotGetInput> = serde_json::from_value(args).ok();
            to_json(app_system::context_snapshot_get(input))
        }
        "context_action_dispatch" => {
            let input = match parse_args::<ContextActionDispatchInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_system::context_action_dispatch(input))
        }
        "context_capabilities" => to_json(app_system::context_capabilities()),
        "context_health" => to_json(app_system::context_health()),

        // =================================================================
        // Skills (no state)
        // =================================================================
        "skills_list" => {
            let input = match parse_args::<SkillsListInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_list(input))
        }
        "skills_search" => {
            let input = match parse_args::<SkillsSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_search(input))
        }
        "skills_get" => {
            let input = match parse_args::<SkillIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_get(input))
        }
        "skills_get_builtin" => {
            let input = match parse_args::<BuiltinSkillIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_get_builtin(input))
        }
        "skills_create" => {
            let input = match parse_args::<SkillCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_create(input))
        }
        "skills_update" => {
            let input = match parse_args::<SkillUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_update(input))
        }
        "skills_delete" => {
            let input = match parse_args::<SkillIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_delete(input))
        }
        "skills_toggle" => {
            let input = match parse_args::<SkillToggleInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills::skills_toggle(input))
        }

        // =================================================================
        // Skills Market (no state)
        // =================================================================
        "skills_import_url" => {
            let input = match parse_args::<SkillImportAddressInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_import_url(input))
        }
        "skills_import_github" => {
            let input = match parse_args::<SkillImportGitHubInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_import_github(input))
        }
        "skills_market_dir" => to_json(app_skills_market::skills_market_dir()),
        "skills_market_open_dir" => to_json(app_skills_market::skills_market_open_dir()),
        "skills_market_list" => to_json(app_skills_market::skills_market_list()),
        "skills_market_add" => {
            let input = match parse_args::<SkillMarketAddInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_market_add(input))
        }
        "skills_market_remove" => {
            let input = match parse_args::<SkillMarketIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_market_remove(input))
        }
        "skills_market_sync" => {
            let input = match parse_args::<SkillMarketSyncInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_market_sync(input))
        }
        "skills_market_list_skills" => {
            let input = match parse_args::<SkillMarketListInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_market_list_skills(input))
        }
        "skills_market_detail" => {
            let input = match parse_args::<SkillMarketDetailInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_market_detail(input))
        }
        "skills_market_install" => {
            let input = match parse_args::<SkillMarketDetailInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_skills_market::skills_market_install(input))
        }

        // =================================================================
        // Notebook (no state)
        // =================================================================
        "notebook_list_documents" => {
            let input = match parse_args::<TopicIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_notebook::notebook_list_documents(input))
        }
        "notebook_get_document" => {
            let input = match parse_args::<NotebookIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_notebook::notebook_get_document(input))
        }
        "notebook_create_document" => {
            let input = match parse_args::<NotebookCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_notebook::notebook_create_document(input))
        }
        "notebook_update_document" => {
            let input = match parse_args::<NotebookUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_notebook::notebook_update_document(input))
        }
        "notebook_delete_document" => {
            let input = match parse_args::<NotebookIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_notebook::notebook_delete_document(input))
        }
        "notebook_list_all_documents" => to_json(app_notebook::notebook_list_all_documents()),

        // =================================================================
        // Applets (state-dependent)
        // =================================================================
        "applets_list" => to_json(app_applets::applets_list(state)),
        "applets_get" => {
            let input = match parse_args::<AppletIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_get(state, input))
        }
        "applets_activate" => {
            let input = match parse_args::<AppletIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_activate(state, input))
        }
        "applets_deactivate" => {
            let input = match parse_args::<AppletIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_deactivate(state, input))
        }
        "applets_get_config" => {
            let input = match parse_args::<AppletIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_get_config(state, input))
        }
        "applets_set_config" => {
            let input = match parse_args::<AppletConfigSetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_set_config(state, input))
        }
        "applets_action" => {
            let input = match parse_args::<AppletActionInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_action(state, input))
        }
        "applets_invoke" => {
            let input = match parse_args::<AppletInvokeInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_applets::applets_invoke(state, input))
        }

        // =================================================================
        // MCP (no state)
        // =================================================================
        "mcp_list_servers" => to_json(app_mcp::mcp_list_servers()),
        "mcp_get_server" => {
            let input = match parse_args::<McpNameInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_mcp::mcp_get_server(input))
        }
        "mcp_create_server" => {
            let input = match parse_args::<McpCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_mcp::mcp_create_server(input))
        }
        "mcp_update_server" => {
            let input = match parse_args::<McpUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_mcp::mcp_update_server(input))
        }
        "mcp_delete_server" => {
            let input = match parse_args::<McpNameInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_mcp::mcp_delete_server(input))
        }
        "mcp_toggle_server" => {
            let input = match parse_args::<McpToggleInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_mcp::mcp_toggle_server(input))
        }
        "mcp_test_server" => {
            let input = match parse_args::<McpNameInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_mcp::mcp_test_server(input))
        }

        // =================================================================
        // Cron (no state)
        // =================================================================
        "cron_status" => to_json(app_cron::cron_status()),
        "cron_list_jobs" => to_json(app_cron::cron_list_jobs()),
        "cron_create_job" => {
            let input = match parse_args::<CronCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_create_job(input))
        }
        "cron_update_job" => {
            let input = match parse_args::<CronUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_update_job(input))
        }
        "cron_delete_job" => {
            let input = match parse_args::<CronIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_delete_job(input))
        }
        "cron_toggle_job" => {
            let input = match parse_args::<CronToggleInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_toggle_job(input))
        }
        "cron_run_job" => {
            let input = match parse_args::<CronIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_run_job(input))
        }
        "cron_list_runs" => {
            let input = match parse_args::<CronRunsInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_list_runs(input))
        }
        "cron_parse_schedule" => {
            let input = match parse_args::<CronParseScheduleInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_cron::cron_parse_schedule(input))
        }

        // =================================================================
        // Model Config (no state)
        // =================================================================
        "model_config_list" => to_json(app_model_config::model_config_list()),
        "model_config_get" => {
            let input = match parse_args::<ModelConfigKeyInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_model_config::model_config_get(input))
        }
        "model_config_set" => {
            let input = match parse_args::<ModelConfigSetInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_model_config::model_config_set(input))
        }
        "model_config_delete" => {
            let input = match parse_args::<ModelConfigKeyInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_model_config::model_config_delete(input))
        }
        "model_config_provider_references" => {
            let input = match parse_args::<ProviderIdInputV2>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_model_config::model_config_provider_references(input))
        }

        // =================================================================
        // Channels (no state)
        // =================================================================
        "channels_list" => to_json(app_channels::channels_list()),
        "channels_get" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_get(input))
        }
        "channels_create" => {
            let input = match parse_args::<ChannelCreateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_create(input))
        }
        "channels_update" => {
            let input = match parse_args::<ChannelUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_update(input))
        }
        "channels_delete" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_delete(input))
        }
        "channels_test" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_test(input))
        }
        "channels_send" => {
            let input = match parse_args::<ChannelSendMessageInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_send(input))
        }
        "channels_list_chats" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_list_chats(input))
        }
        "channels_start_bot" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_start_bot(input))
        }
        "channels_stop_bot" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_stop_bot(input))
        }
        "channels_bot_status" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_bot_status(input))
        }
        "channels_list_events" => {
            let input = match parse_args::<ChannelEventsInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_list_events(input))
        }
        "channels_stats" => {
            let input = match parse_args::<ChannelIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_channels::channels_stats(input))
        }

        // =================================================================
        // OAuth2 (no state)
        // =================================================================
        "oauth2_list_providers" => to_json(app_oauth2::oauth2_list_providers()),
        "oauth2_get_provider" => {
            let input = match parse_args::<OAuthIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_get_provider(input))
        }
        "oauth2_get_credential_info" => {
            let input = match parse_args::<OAuthIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_get_credential_info(input))
        }
        "oauth2_set_credentials" => {
            let input = match parse_args::<OAuthSetCredentialsInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_set_credentials(input))
        }
        "oauth2_authorize" => {
            let input = match parse_args::<OAuthAuthorizeInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_authorize(input))
        }
        "oauth2_handle_callback" => {
            let input = match parse_args::<OAuthCallbackInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_handle_callback(input))
        }
        "oauth2_list_connections" => to_json(app_oauth2::oauth2_list_connections()),
        "oauth2_get_connection" => {
            let input = match parse_args::<OAuthIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_get_connection(input))
        }
        "oauth2_disconnect" => {
            let input = match parse_args::<OAuthIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_disconnect(input))
        }
        "oauth2_refresh_token" => {
            let input = match parse_args::<OAuthIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_refresh_token(input))
        }
        "oauth2_call_resource" => {
            let input = match parse_args::<OAuthResourceInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_call_resource(input))
        }
        "oauth2_reload" => to_json(app_oauth2::oauth2_reload()),
        "oauth2_get_page" => {
            let input = match parse_args::<OAuthIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_get_page(input))
        }
        "oauth2_start_loopback" => {
            let input = match parse_args::<OAuthLoopbackStartInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_start_loopback(input, state.i18n.clone()))
        }
        "oauth2_poll_loopback" => {
            let input = match parse_args::<OAuthLoopbackPollInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_oauth2::oauth2_poll_loopback(input))
        }

        // =================================================================
        // Account (no state)
        // =================================================================
        "account_list" => to_json(app_account::account_list()),
        "account_get_active" => to_json(app_account::account_get_active()),
        "account_switch" => {
            let input = match parse_args::<AccountIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_account::account_switch(input))
        }
        "account_upsert_oauth" => {
            let input = match parse_args::<AccountUpsertOAuthInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_account::account_upsert_oauth(input))
        }
        "account_set_pin" => {
            let input = match parse_args::<AccountSetPinInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = state.session.lock().ok().and_then(|g| g.token.clone());
            to_json(app_account::account_set_pin(input, token.as_deref()))
        }
        "account_unlock" => {
            let input = match parse_args::<AccountUnlockInput>(args) { Ok(v) => v, Err(e) => return e };
            let result = app_account::account_unlock(input.clone());
            if !result.ok {
                return serde_json::to_value(&result).unwrap_or(json!({"ok": false}));
            }
            // Parse token from the stub payload and write to AppState
            let token = result.data.as_ref()
                .and_then(|d| serde_json::from_str::<serde_json::Value>(&d.status).ok())
                .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(|s| s.to_string()));
            if let Some(ref t) = token {
                let actor_id = input.account_id.split_once(':').map(|(_, id)| id.to_string()).unwrap_or_else(|| input.account_id.clone());
                let session = crate::domain::auth::session::from_station_response(actor_id, t.clone());
                if let Ok(mut guard) = state.session.lock() {
                    guard.actor_id = Some(session.actor_id.clone());
                    guard.token = Some(session.token.clone());
                }
                let _ = crate::infrastructure::auth_identity::save_encrypted_session(&input.account_id, &input.pin, t);
                let _ = app_account::account_switch(AccountIdInput { id: input.account_id.clone() });
                let profile = crate::infrastructure::auth_identity::find_profile_by_actor_id(&session.actor_id);
                let (p_name, p_email, p_avatar, p_method) = match &profile {
                    Some(p) => (
                        Some(p.name.clone()).filter(|v| !v.is_empty()),
                        Some(p.email.clone()).filter(|v| !v.is_empty()),
                        Some(p.avatar_url.clone()).filter(|v| !v.is_empty()),
                        Some(p.provider.clone()),
                    ),
                    None => (None, None, None, None),
                };
                return to_json(AppResult::success(crate::contracts::AuthSessionPayload {
                    command: "account_unlock".to_string(),
                    status: "authenticated".to_string(),
                    actor_id: Some(session.actor_id),
                    name: p_name,
                    email: p_email,
                    avatar_url: p_avatar,
                    login_method: p_method,
                }));
            }
            serde_json::to_value(&result).unwrap_or(json!({"ok": false}))
        }
        "account_list_restorable" => to_json(app_account::account_list_restorable()),

        // =================================================================
        // Memory (no state)
        // =================================================================
        "memory_list" => {
            let input = match parse_args::<MemoryListInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_list(input))
        }
        "memory_get" => {
            let input = match parse_args::<MemoryIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_get(input))
        }
        "memory_delete" => {
            let input = match parse_args::<MemoryIdInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_delete(input))
        }
        "memory_search" => {
            let input = match parse_args::<MemorySearchInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_search(input))
        }
        "memory_persona" => {
            let input = match parse_args::<MemoryPersonaInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_persona(input))
        }
        "memory_stats" => to_json(app_memory::memory_stats()),
        "memory_events" => {
            let input = match parse_args::<MemoryEventsInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_events(input))
        }
        "memory_export" => {
            let input = match parse_args::<MemoryExportInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_export(input))
        }
        "memory_import" => {
            let input = match parse_args::<MemoryImportInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_memory::memory_import(input))
        }
        "memory_embedding_status" => to_json(app_memory::memory_embedding_status()),
        "memory_reembed" => to_json(app_memory::memory_reembed()),

        // =================================================================
        // TTS (no state)
        // =================================================================
        "tts_synthesize" => {
            let input = match parse_args::<TtsInput>(args) { Ok(v) => v, Err(e) => return e };
            to_json(app_tts::tts_synthesize(input))
        }
        "tts_voices" => to_json(app_tts::tts_voices()),

        // =================================================================
        // Friend Chat (state-dependent, station JSON API)
        // =================================================================
        "friend_chat_list_sessions" => {
            let input = match parse_args::<FriendChatListInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let query = vec![
                ("limit", input.limit.unwrap_or(50).to_string()),
                ("offset", input.offset.unwrap_or(0).to_string()),
            ];
            match station_request_json(Method::GET, "/friend-chat/sessions", &token, Some(&query), None) {
                Ok(data) => to_json(to_stub("friend_chat_list_sessions", data)),
                Err(e) => e,
            }
        }
        "friend_chat_create_session" => {
            let input = match parse_args::<FriendChatCreateSessionInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            if input.participant_did.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "participant_did is required", None));
            }
            match station_request_json(Method::POST, "/friend-chat/session/create", &token, None, Some(json!({"participant_did": input.participant_did}))) {
                Ok(data) => to_json(to_stub("friend_chat_create_session", data)),
                Err(e) => e,
            }
        }
        "friend_chat_list_messages" => {
            let input = match parse_args::<FriendChatListMessagesInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            if input.session_ulid.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "session_ulid is required", None));
            }
            let mut query = vec![
                ("session_ulid", input.session_ulid),
                ("limit", input.limit.unwrap_or(50).to_string()),
            ];
            if let Some(before) = input.before_ulid { query.push(("before_ulid", before)); }
            let data = match station_request_json(Method::GET, "/friend-chat/messages", &token, Some(&query), None) {
                Ok(d) => d, Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &data);
            to_json(to_stub("friend_chat_list_messages", data))
        }
        "friend_chat_send_message" => {
            let input = match parse_args::<FriendChatSendInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let data = match station_request_json(Method::POST, "/friend-chat/message/send", &token, None, Some(json!({
                "session_ulid": input.session_ulid, "receiver_did": input.receiver_did,
                "content": input.content,
                "encrypted_payload": input.encrypted_payload.unwrap_or_default(),
                "type": input.r#type.unwrap_or(1),
                "reply_to_ulid": input.reply_to_ulid.unwrap_or_default(),
                "attachments": input.attachments.unwrap_or_default(),
            }))) {
                Ok(d) => d, Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &data);
            to_json(to_stub("friend_chat_send_message", data))
        }
        "friend_chat_ack_messages" => {
            let input = match parse_args::<FriendChatAckInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/friend-chat/message/ack", &token, None, Some(json!({"ulids": input.ulids, "status": input.status}))) {
                Ok(data) => to_json(to_stub("friend_chat_ack_messages", data)),
                Err(e) => e,
            }
        }
        "friend_chat_sync_messages" => {
            let input = match parse_args::<FriendChatSyncMessagesInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/friend-chat/message/sync", &token, None, Some(json!({"messages": input.messages}))) {
                Ok(data) => to_json(to_stub("friend_chat_sync_messages", data)),
                Err(e) => e,
            }
        }
        "friend_chat_go_online" => {
            let input = match parse_args::<FriendChatOnlineInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let body = match &input.did { Some(did) => json!({"did": did}), None => json!({}) };
            match station_request_json(Method::POST, "/friend-chat/online", &token, None, Some(body)) {
                Ok(data) => to_json(to_stub("friend_chat_go_online", data)),
                Err(e) => e,
            }
        }
        "friend_chat_go_offline" => {
            let input = match parse_args::<FriendChatOnlineInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let body = match &input.did { Some(did) => json!({"did": did}), None => json!({}) };
            match station_request_json(Method::POST, "/friend-chat/offline", &token, None, Some(body)) {
                Ok(data) => to_json(to_stub("friend_chat_go_offline", data)),
                Err(e) => e,
            }
        }
        "friend_chat_get_pending" => {
            let input = match parse_args::<FriendChatPendingInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let query = vec![("limit", input.limit.unwrap_or(50).to_string())];
            match station_request_json(Method::GET, "/friend-chat/pending", &token, Some(&query), None) {
                Ok(data) => to_json(to_stub("friend_chat_get_pending", data)),
                Err(e) => e,
            }
        }
        "friend_chat_get_stats" => {
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::GET, "/friend-chat/stats", &token, None, None) {
                Ok(data) => to_json(to_stub("friend_chat_get_stats", data)),
                Err(e) => e,
            }
        }
        "key_exchange_upload_bundle" => {
            let input = match parse_args::<KeyExchangeUploadInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let req = model::key_exchange::UploadKeyBundleRequest {
                ik_pub: input.ik_pub,
                spk_id: input.spk_id,
                spk_pub: input.spk_pub,
                spk_sig: input.spk_sig,
                opk_ids: input.opk_ids,
                opk_pubs: input.opk_pubs,
            };
            match station_client::request_proto::<
                model::key_exchange::UploadKeyBundleRequest,
                model::key_exchange::UploadKeyBundleResponse,
            >(Method::POST, "/key-exchange/keys/bundle", &token, None, Some(&req)) {
                Ok(_r) => to_json(to_stub("key_exchange_upload_bundle", json!({}))),
                Err(e) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "key_exchange_fetch_bundle" => {
            let input = match parse_args::<KeyExchangeFetchInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            if input.did.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "did is required", None));
            }
            let req = model::key_exchange::FetchKeyBundleRequest { did: input.did };
            match station_client::request_proto::<
                model::key_exchange::FetchKeyBundleRequest,
                model::key_exchange::FetchKeyBundleResponse,
            >(Method::POST, "/key-exchange/keys/bundle/fetch", &token, None, Some(&req)) {
                Ok(r) => to_json(to_stub("key_exchange_fetch_bundle", json!({
                    "actor_did": r.actor_did,
                    "ik_pub": r.ik_pub,
                    "fingerprint": r.fingerprint,
                    "spk_id": r.spk_id,
                    "spk_pub": r.spk_pub,
                    "spk_sig": r.spk_sig,
                    "opk_id": r.opk_id,
                    "opk_pub": r.opk_pub,
                }))),
                Err(e) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "friend_chat_local_search" => {
            let input = match parse_args::<ChatLocalSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.query.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "query is required", None));
            }
            let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
            match chat_storage::search_friend_messages("__default__", &input.query, limit) {
                Ok(items) => to_json(to_stub("friend_chat_local_search", json!({"messages": items}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "local search failed", Some(json!({"reason": reason})))),
            }
        }
        "friend_chat_local_search_scoped" => {
            let input = match parse_args::<ChatLocalSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.query.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "query is required", None));
            }
            let user_scope = user_scope_from_state(state);
            let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
            match chat_storage::search_friend_messages(&user_scope, &input.query, limit) {
                Ok(items) => to_json(to_stub("friend_chat_local_search_scoped", json!({"messages": items}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "local search failed", Some(json!({"reason": reason})))),
            }
        }
        "friend_chat_set_cursor_scoped" => {
            let input = match parse_args::<ChatScopeCursorSetInput>(args) { Ok(v) => v, Err(e) => return e };
            let user_scope = user_scope_from_state(state);
            if input.scope.trim().is_empty() || input.cursor.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "scope and cursor are required", None));
            }
            if let Err(reason) = chat_storage::set_scope_cursor(&user_scope, &input.scope, &input.cursor) {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "set cursor failed", Some(json!({"reason": reason}))));
            }
            to_json(to_stub("friend_chat_set_cursor_scoped", json!({"ok": true})))
        }
        "friend_chat_get_cursor_scoped" => {
            let input = match parse_args::<ChatScopeCursorGetInput>(args) { Ok(v) => v, Err(e) => return e };
            let user_scope = user_scope_from_state(state);
            if input.scope.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "scope is required", None));
            }
            match chat_storage::get_scope_cursor(&user_scope, &input.scope) {
                Ok(cursor) => to_json(to_stub("friend_chat_get_cursor_scoped", json!({"cursor": cursor}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "get cursor failed", Some(json!({"reason": reason})))),
            }
        }
        "friend_chat_get_key_version_scoped" => {
            let user_scope = user_scope_from_state(state);
            match chat_storage::get_chat_key_version(&user_scope) {
                Ok(v) => to_json(to_stub("friend_chat_get_key_version_scoped", json!({"key_version": v}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "get key version failed", Some(json!({"reason": reason})))),
            }
        }
        "friend_chat_rotate_key_scoped" => {
            let input = match parse_args::<ChatKeyRotateInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.next_version <= 0 {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "next_version must be positive", None));
            }
            let user_scope = user_scope_from_state(state);
            match chat_storage::rotate_chat_key(&user_scope, input.next_version) {
                Ok(v) => to_json(to_stub("friend_chat_rotate_key_scoped", json!({"key_version": v}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "rotate key failed", Some(json!({"reason": reason})))),
            }
        }
        "friend_chat_sync_from_station_scoped" => {
            dispatch_friend_sync_from_station(args, state)
        }
        "friend_chat_send_friend_request" => {
            let input = match parse_args::<FriendRequestSendInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/friend-chat/friend-request/send", &token, None, Some(json!({
                "receiver_did": input.receiver_did,
                "message": input.message.unwrap_or_default(),
            }))) {
                Ok(data) => to_json(to_stub("friend_chat_send_friend_request", data)),
                Err(e) => e,
            }
        }
        "friend_chat_accept_friend_request" => {
            let input = match parse_args::<FriendRequestActionInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/friend-chat/friend-request/accept", &token, None, Some(json!({"request_id": input.request_id}))) {
                Ok(data) => to_json(to_stub("friend_chat_accept_friend_request", data)),
                Err(e) => e,
            }
        }
        "friend_chat_reject_friend_request" => {
            let input = match parse_args::<FriendRequestActionInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/friend-chat/friend-request/reject", &token, None, Some(json!({"request_id": input.request_id}))) {
                Ok(data) => to_json(to_stub("friend_chat_reject_friend_request", data)),
                Err(e) => e,
            }
        }
        "friend_chat_list_friend_requests" => {
            let input = match parse_args::<FriendRequestListInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(st) = input.status {
                query.push(("status", st.to_string()));
            }
            let limit = input.limit.unwrap_or(20);
            query.push(("limit", limit.to_string()));
            let offset = input.offset.unwrap_or(0);
            query.push(("offset", offset.to_string()));
            match station_request_json(Method::GET, "/friend-chat/friend-requests", &token, Some(&query), None) {
                Ok(data) => to_json(to_stub("friend_chat_list_friend_requests", data)),
                Err(e) => e,
            }
        }

        // =================================================================
        // Group Chat (state-dependent, station JSON API + proto)
        // =================================================================
        "group_chat_list_groups" => {
            let input = match parse_args::<GroupChatListInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let query = vec![
                ("limit", input.limit.unwrap_or(50).to_string()),
                ("offset", input.offset.unwrap_or(0).to_string()),
            ];
            match station_request_json(Method::GET, "/group-chat/list", &token, Some(&query), None) {
                Ok(data) => to_json(to_stub("group_chat_list_groups", data)),
                Err(e) => e,
            }
        }
        "group_chat_list_messages" => {
            let input = match parse_args::<GroupChatListMessagesInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            if input.group_ulid.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "group_ulid is required", None));
            }
            let mut query = vec![
                ("group_ulid", input.group_ulid),
                ("limit", input.limit.unwrap_or(50).to_string()),
            ];
            if let Some(before) = input.before_ulid { query.push(("before_ulid", before)); }
            let data = match station_request_json(Method::GET, "/group-chat/messages", &token, Some(&query), None) {
                Ok(d) => d, Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            let _ = chat_storage::ingest_group_messages(&user_scope, &data);
            to_json(to_stub("group_chat_list_messages", data))
        }
        "group_chat_send_message" => {
            let input = match parse_args::<GroupChatSendInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let data = match station_request_json(Method::POST, "/group-chat/message/send", &token, None, Some(json!({
                "group_ulid": input.group_ulid, "content": input.content,
                "type": input.r#type.unwrap_or(1),
                "reply_to_ulid": input.reply_to_ulid.unwrap_or_default(),
                "mentioned_dids": input.mentioned_dids.unwrap_or_default(),
                "mention_all": input.mention_all.unwrap_or(false),
                "attachments": input.attachments.unwrap_or_default(),
            }))) {
                Ok(d) => d, Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            let _ = chat_storage::ingest_group_messages(&user_scope, &data);
            to_json(to_stub("group_chat_send_message", data))
        }
        "group_chat_unread_count" => {
            let input = match parse_args::<GroupChatUnreadInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let mut query = Vec::new();
            if let Some(g) = input.group_ulid { query.push(("group_ulid", g)); }
            match station_request_json(Method::GET, "/group-chat/unread-count", &token, Some(&query), None) {
                Ok(data) => to_json(to_stub("group_chat_unread_count", data)),
                Err(e) => e,
            }
        }
        "group_chat_mark_read" => {
            let input = match parse_args::<GroupChatMarkReadInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/mark-read", &token, None, Some(json!({"group_ulid": input.group_ulid}))) {
                Ok(data) => to_json(to_stub("group_chat_mark_read", data)),
                Err(e) => e,
            }
        }
        "group_chat_create_group" => {
            let input = match parse_args::<GroupChatCreateGroupInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let req = model::chat::CreateGroupRequest {
                name: input.name,
                description: input.description.unwrap_or_default(),
                initial_member_dids: input.member_dids.unwrap_or_default(),
                ..Default::default()
            };
            let resp = match station_client::request_proto::<model::chat::CreateGroupRequest, model::chat::CreateGroupResponse>(
                Method::POST, "/group-chat/create", &token, None, Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
            };
            let group_json = match resp.group {
                Some(g) => json!({"ulid": g.ulid, "name": g.name, "description": g.description, "owner_did": g.owner_did, "type": g.r#type}),
                None => json!(null),
            };
            to_json(to_stub("group_chat_create_group", json!({"group": group_json})))
        }
        "group_chat_get_group" => {
            let input = match parse_args::<GroupUlidInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::GET,
                "/group-chat/info",
                &token,
                None,
                Some(json!({ "group_ulid": input.group_ulid })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_group" => {
            let input = match parse_args::<GroupUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::PUT,
                "/group-chat/update",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "name": input.name,
                    "description": input.description.unwrap_or_default(),
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_update_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_invite_to_group" => {
            let input = match parse_args::<GroupInviteInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/invite", &token, None, Some(json!({
                "group_ulid": input.group_ulid,
                "invitee_dids": input.member_dids,
            }))) {
                Ok(data) => to_json(to_stub("group_chat_invite_to_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_join_group" => {
            let input = match parse_args::<GroupJoinInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/join", &token, None, Some(json!({
                "group_ulid": input.group_ulid,
                "invitation_ulid": input.invitation_ulid.unwrap_or_default(),
            }))) {
                Ok(data) => to_json(to_stub("group_chat_join_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_leave_group" => {
            let input = match parse_args::<GroupChatLeaveGroupInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let req = model::chat::LeaveGroupRequest { group_ulid: input.group_ulid };
            let resp = match station_client::request_proto::<model::chat::LeaveGroupRequest, model::chat::LeaveGroupResponse>(
                Method::POST, "/group-chat/leave", &token, None, Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, &e, None)),
            };
            to_json(to_stub("group_chat_leave_group", json!({"success": resp.success})))
        }
        "group_chat_get_members" => {
            let input = match parse_args::<GroupMembersInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::GET,
                "/group-chat/members",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "limit": input.limit.unwrap_or(100) as i32,
                    "offset": input.offset.unwrap_or(0) as i32,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_members", data)),
                Err(e) => e,
            }
        }
        "group_chat_remove_member" => {
            let input = match parse_args::<GroupRemoveMemberInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/member/remove", &token, None, Some(json!({
                "group_ulid": input.group_ulid,
                "actor_did": input.member_did,
            }))) {
                Ok(data) => to_json(to_stub("group_chat_remove_member", data)),
                Err(e) => e,
            }
        }
        "group_chat_recall_message" => {
            let input = match parse_args::<GroupMessageActionInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/message/recall", &token, None, Some(json!({
                "group_ulid": input.group_ulid, "message_ulid": input.message_ulid,
            }))) {
                Ok(data) => to_json(to_stub("group_chat_recall_message", data)),
                Err(e) => e,
            }
        }
        "group_chat_delete_message" => {
            let input = match parse_args::<GroupMessageActionInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/message/delete", &token, None, Some(json!({
                "group_ulid": input.group_ulid, "message_ulid": input.message_ulid,
            }))) {
                Ok(data) => to_json(to_stub("group_chat_delete_message", data)),
                Err(e) => e,
            }
        }
        "group_chat_search_messages" => {
            let input = match parse_args::<GroupSearchMessagesInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::GET,
                "/group-chat/messages/search",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "query": input.query,
                    "limit": input.limit.unwrap_or(50) as i32,
                    "before_ulid": "",
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_search_messages", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_nickname" => {
            let input = match parse_args::<GroupUpdateNicknameInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::PUT,
                "/group-chat/member/nickname",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "nickname": input.nickname,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_update_nickname", data)),
                Err(e) => e,
            }
        }
        "group_chat_get_settings" => {
            let input = match parse_args::<GroupUlidInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::GET,
                "/group-chat/my-settings",
                &token,
                None,
                Some(json!({ "group_ulid": input.group_ulid })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_settings", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_settings" => {
            let input = match parse_args::<GroupUpdateMySettingsInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let mut body = json!({"group_ulid": input.group_ulid});
            if let Some(v) = input.is_muted { body["is_muted"] = json!(v); }
            if let Some(v) = input.is_pinned { body["is_pinned"] = json!(v); }
            if let Some(v) = input.show_member_nickname { body["show_member_nickname"] = json!(v); }
            match station_request_json(Method::PUT, "/group-chat/my-settings", &token, None, Some(body)) {
                Ok(data) => to_json(to_stub("group_chat_update_settings", data)),
                Err(e) => e,
            }
        }
        "group_chat_get_offline_messages" => {
            let input = match parse_args::<GroupOfflineMessagesInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::GET,
                "/group-chat/offline-messages",
                &token,
                None,
                Some(json!({ "limit": input.limit.unwrap_or(100) as i32 })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_offline_messages", data)),
                Err(e) => e,
            }
        }
        "group_chat_ack_offline_messages" => {
            let input = match parse_args::<GroupAckOfflineInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/group-chat/offline-messages/ack", &token, None, Some(json!({
                "ulids": input.message_ulids,
            }))) {
                Ok(data) => to_json(to_stub("group_chat_ack_offline_messages", data)),
                Err(e) => e,
            }
        }
        "group_chat_get_stats" => {
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::GET, "/group-chat/stats", &token, None, None) {
                Ok(data) => to_json(to_stub("group_chat_get_stats", data)),
                Err(e) => e,
            }
        }
        "group_chat_local_search" => {
            let input = match parse_args::<ChatLocalSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.query.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "query is required", None));
            }
            let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
            match chat_storage::search_group_messages("__default__", &input.query, limit) {
                Ok(items) => to_json(to_stub("group_chat_local_search", json!({"messages": items}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "local search failed", Some(json!({"reason": reason})))),
            }
        }
        "group_chat_local_search_scoped" => {
            let input = match parse_args::<ChatLocalSearchInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.query.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "query is required", None));
            }
            let user_scope = user_scope_from_state(state);
            let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
            match chat_storage::search_group_messages(&user_scope, &input.query, limit) {
                Ok(items) => to_json(to_stub("group_chat_local_search_scoped", json!({"messages": items}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "local search failed", Some(json!({"reason": reason})))),
            }
        }
        "group_chat_set_cursor_scoped" => {
            let input = match parse_args::<ChatScopeCursorSetInput>(args) { Ok(v) => v, Err(e) => return e };
            let user_scope = user_scope_from_state(state);
            if input.scope.trim().is_empty() || input.cursor.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "scope and cursor are required", None));
            }
            if let Err(reason) = chat_storage::set_scope_cursor(&user_scope, &input.scope, &input.cursor) {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "set cursor failed", Some(json!({"reason": reason}))));
            }
            to_json(to_stub("group_chat_set_cursor_scoped", json!({"ok": true})))
        }
        "group_chat_get_cursor_scoped" => {
            let input = match parse_args::<ChatScopeCursorGetInput>(args) { Ok(v) => v, Err(e) => return e };
            let user_scope = user_scope_from_state(state);
            if input.scope.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "scope is required", None));
            }
            match chat_storage::get_scope_cursor(&user_scope, &input.scope) {
                Ok(cursor) => to_json(to_stub("group_chat_get_cursor_scoped", json!({"cursor": cursor}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "get cursor failed", Some(json!({"reason": reason})))),
            }
        }
        "group_chat_get_key_version_scoped" => {
            let user_scope = user_scope_from_state(state);
            match chat_storage::get_chat_key_version(&user_scope) {
                Ok(v) => to_json(to_stub("group_chat_get_key_version_scoped", json!({"key_version": v}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "get key version failed", Some(json!({"reason": reason})))),
            }
        }
        "group_chat_rotate_key_scoped" => {
            let input = match parse_args::<ChatKeyRotateInput>(args) { Ok(v) => v, Err(e) => return e };
            if input.next_version <= 0 {
                return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "next_version must be positive", None));
            }
            let user_scope = user_scope_from_state(state);
            match chat_storage::rotate_chat_key(&user_scope, input.next_version) {
                Ok(v) => to_json(to_stub("group_chat_rotate_key_scoped", json!({"key_version": v}))),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "rotate key failed", Some(json!({"reason": reason})))),
            }
        }
        "group_chat_sync_from_station_scoped" => {
            dispatch_group_sync_from_station(args, state)
        }

        // =================================================================
        // Notifications (state-dependent, station JSON API)
        // =================================================================
        "notification_list" => {
            let input = match parse_args::<NotificationListInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(cat) = input.category {
                query.push(("category", cat.to_string()));
            }
            if let Some(st) = input.status {
                query.push(("status", st.to_string()));
            }
            if let Some(ref c) = input.cursor {
                query.push(("cursor", c.clone()));
            }
            let limit = input.limit.unwrap_or(20);
            query.push(("limit", limit.to_string()));
            match station_request_json(Method::GET, "/notification/list", &token, Some(&query), None) {
                Ok(data) => to_json(to_stub("notification_list", data)),
                Err(e) => e,
            }
        }
        "notification_unread_counts" => {
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::GET, "/notification/unread-counts", &token, None, None) {
                Ok(data) => to_json(to_stub("notification_unread_counts", data)),
                Err(e) => e,
            }
        }
        "notification_mark_read" => {
            let input = match parse_args::<NotificationMarkReadInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/notification/mark-read", &token, None, Some(json!({"notification_ids": input.notification_ids}))) {
                Ok(data) => to_json(to_stub("notification_mark_read", data)),
                Err(e) => e,
            }
        }
        "notification_mark_all_read" => {
            let input = match parse_args::<NotificationMarkAllReadInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/notification/mark-all-read", &token, None, Some(json!({"category": input.category.unwrap_or(0)}))) {
                Ok(data) => to_json(to_stub("notification_mark_all_read", data)),
                Err(e) => e,
            }
        }
        "notification_delete" => {
            let input = match parse_args::<NotificationDeleteInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::POST, "/notification/delete", &token, None, Some(json!({"notification_ids": input.notification_ids}))) {
                Ok(data) => to_json(to_stub("notification_delete", data)),
                Err(e) => e,
            }
        }
        "notification_preferences" => {
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(Method::GET, "/notification/preferences", &token, None, None) {
                Ok(data) => to_json(to_stub("notification_preferences", data)),
                Err(e) => e,
            }
        }
        "notification_preferences_update" => {
            let input = match parse_args::<NotificationPreferenceUpdateInput>(args) { Ok(v) => v, Err(e) => return e };
            let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
            match station_request_json(
                Method::POST,
                "/notification/preferences/update",
                &token,
                None,
                Some(json!({
                    "category": input.category,
                    "enabled": input.enabled,
                    "push_enabled": input.push_enabled,
                    "sound_enabled": input.sound_enabled,
                })),
            ) {
                Ok(data) => to_json(to_stub("notification_preferences_update", data)),
                Err(e) => e,
            }
        }

        // =================================================================
        // Unknown command
        // =================================================================
        _ => {
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::NotFound,
                format!("unknown command: {cmd}"),
                Some(json!({"command": cmd})),
            ))
        }
    }
}

// -------------------------------------------------------------------------
// Complex multi-page sync dispatchers (extracted for readability)
// -------------------------------------------------------------------------

fn dispatch_friend_sync_from_station(args: Value, state: &AppState) -> Value {
    let input = match parse_args::<FriendChatSyncInput>(args) { Ok(v) => v, Err(e) => return e };
    let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
    if input.session_ulid.trim().is_empty() {
        return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "session_ulid is required", None));
    }
    let user_scope = user_scope_from_state(state);
    let scope_key = format!("friend:{}", input.session_ulid);
    let cursor = match chat_storage::get_scope_cursor(&user_scope, &scope_key) {
        Ok(c) => c,
        Err(reason) => return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "get cursor failed", Some(json!({"reason": reason})))),
    };
    let page_limit = input.limit.unwrap_or(100);
    let max_pages = input.max_pages.unwrap_or(10);
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let mut query = vec![
            ("session_ulid", input.session_ulid.clone()),
            ("limit", page_limit.to_string()),
        ];
        if let Some(ref existing) = current_cursor {
            if !existing.trim().is_empty() {
                query.push(("before_ulid", format!("since:{existing}")));
            }
        }
        let data = match station_request_json(Method::GET, "/friend-chat/messages", &token, Some(&query), None) {
            Ok(d) => d, Err(e) => return e,
        };
        pages_fetched += 1;
        let (incremental, synced_count, latest) = filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = chat_storage::ingest_friend_messages(&user_scope, &incremental);
        total_synced += synced_count;
        let server_cursor = data.get("next_cursor").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
        let fallback = extract_latest_ulid(&data);
        let next = server_cursor.or(latest).or(fallback);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(&user_scope, &scope_key, new_cursor);
            current_cursor = Some(new_cursor.clone());
        }
        if !data.get("has_more").and_then(|v| v.as_bool()).unwrap_or(false) { break; }
    }
    to_json(to_stub("friend_chat_sync_from_station_scoped", json!({
        "synced_count": total_synced, "pages_fetched": pages_fetched,
        "cursor_before": cursor, "cursor_after": current_cursor,
    })))
}

fn dispatch_group_sync_from_station(args: Value, state: &AppState) -> Value {
    let input = match parse_args::<GroupChatSyncInput>(args) { Ok(v) => v, Err(e) => return e };
    let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e };
    if input.group_ulid.trim().is_empty() {
        return to_json(AppResult::<StubPayload>::fail(ErrorCode::InvalidArgument, "group_ulid is required", None));
    }
    let user_scope = user_scope_from_state(state);
    let scope_key = format!("group:{}", input.group_ulid);
    let cursor = match chat_storage::get_scope_cursor(&user_scope, &scope_key) {
        Ok(c) => c,
        Err(reason) => return to_json(AppResult::<StubPayload>::fail(ErrorCode::InternalError, "get cursor failed", Some(json!({"reason": reason})))),
    };
    let page_limit = input.limit.unwrap_or(100);
    let max_pages = input.max_pages.unwrap_or(10);
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let mut query = vec![
            ("group_ulid", input.group_ulid.clone()),
            ("limit", page_limit.to_string()),
        ];
        if let Some(ref existing) = current_cursor {
            if !existing.trim().is_empty() {
                query.push(("before_ulid", format!("since:{existing}")));
            }
        }
        let data = match station_request_json(Method::GET, "/group-chat/messages", &token, Some(&query), None) {
            Ok(d) => d, Err(e) => return e,
        };
        pages_fetched += 1;
        let (incremental, synced_count, latest) = filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = chat_storage::ingest_group_messages(&user_scope, &incremental);
        total_synced += synced_count;
        let server_cursor = data.get("next_cursor").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
        let fallback = extract_latest_ulid(&data);
        let next = server_cursor.or(latest).or(fallback);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(&user_scope, &scope_key, new_cursor);
            current_cursor = Some(new_cursor.clone());
        }
        if !data.get("has_more").and_then(|v| v.as_bool()).unwrap_or(false) { break; }
    }
    to_json(to_stub("group_chat_sync_from_station_scoped", json!({
        "synced_count": total_synced, "pages_fetched": pages_fetched,
        "cursor_before": cursor, "cursor_after": current_cursor,
    })))
}
