use crate::application::key_exchange::device_install;
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

use super::key_exchange::active_key_exchange_context;

// --- Input types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationGetInput {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationGetMembersInput {
    pub conversation_id: String,
}

// --- Helper ---

fn get_token(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Value>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn station_err(e: station_client::StationClientError, msg: &str) -> AppResult<Value> {
    e.into_app_result(msg)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListEventsInput {
    pub conversation_id: String,
    pub after_seq: Option<i64>,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_list_events(
    input: ConversationListEventsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("after_seq", input.after_seq.unwrap_or(0).to_string()),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/events",
        &token,
        Some(&query),
        None,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list events failed"),
    }
}

#[tauri::command]
pub fn conversation_get_members(
    input: ConversationGetMembersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![("conversation_id", input.conversation_id)];
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/members",
        &token,
        Some(&query),
        None,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "get members failed"),
    }
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    session_resolver::ptid_for_window(state.inner(), window).unwrap_or_default()
}

// --- Device commands ---

#[tauri::command]
pub fn device_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    match station_client::request_json_auth(Method::GET, "/device/list", &token, None, None) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device list failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRevokeInput {
    pub device_id: String,
    pub observed_profile_version: u64,
}

#[tauri::command]
pub fn device_revoke(
    input: DeviceRevokeInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let context = match active_key_exchange_context::<Value>(&state, &window) {
        Ok(context) => context,
        Err(error) => return error,
    };
    if input.device_id != context.device_id {
        return AppResult::fail(
            ErrorCode::Forbidden,
            "revoked device does not match the active Messaging endpoint",
            None,
        );
    }
    let body = json!({
        "device_id": context.device_id,
        "observed_profile_version": input.observed_profile_version,
    });
    match station_client::request_json_auth_with_device_id(
        Method::POST,
        "/device/revoke",
        &context.token,
        None,
        Some(&body),
        &input.device_id,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "device revoke failed"),
    }
}

// --- Direct Key Exchange (X3DH) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkxSendInput {
    pub recipient_ptid: String,
    pub recipient_device_id: String,
    pub recipient_station_peer_id: Option<String>,
    pub conversation_id: String,
    pub session_id: String,
    pub kind: i32,
    pub opaque_key_material: String,
}

#[tauri::command]
pub fn dkx_send(
    input: DkxSendInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let actor_ptid = user_scope_from_state(&state, &window);
    if actor_ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let sender_device_id = match device_install::get_or_create_device_id(&actor_ptid) {
        Ok(device_id) => device_id,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("device_id: {error}"),
                None,
            );
        }
    };
    let body = json!({
        "recipient_ptid": input.recipient_ptid,
        "recipient_device_id": input.recipient_device_id,
        "recipient_station_peer_id": input.recipient_station_peer_id.unwrap_or_default(),
        "conversation_id": input.conversation_id,
        "session_id": input.session_id,
        "kind": input.kind,
        "opaque_key_material": input.opaque_key_material,
    });
    match station_client::request_json_auth_with_device_id(
        Method::POST,
        "/key-exchange/dkx/send",
        &token,
        None,
        Some(&body),
        &sender_device_id,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "dkx send failed"),
    }
}

// =============================================================================
// Unified Message Queries (P2 — replaces friend_chat_* + group_chat_* commands)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListMessagesInput {
    pub conversation_id: String,
    pub after_seq: Option<i64>,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_list_messages(
    input: ConversationListMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("after_seq", input.after_seq.unwrap_or(0).to_string()),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/messages",
        &token,
        Some(&query),
        None,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list messages failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationListThreadMessagesInput {
    pub conversation_id: String,
    pub root_id: String,
    pub after_seq: Option<i64>,
    pub limit: Option<i32>,
}

#[tauri::command]
pub fn conversation_list_thread_messages(
    input: ConversationListThreadMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("root_id", input.root_id),
        ("after_seq", input.after_seq.unwrap_or(0).to_string()),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/thread/messages",
        &token,
        Some(&query),
        None,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "list thread messages failed"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSyncInput {
    pub conversation_id: String,
    pub limit: Option<i32>,
    pub max_pages: Option<i32>,
}

#[tauri::command]
pub fn conversation_sync_from_station(
    input: ConversationSyncInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = match get_token(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    let limit = input.limit.unwrap_or(200);
    let query = vec![
        ("conversation_id", input.conversation_id),
        ("after_seq", "0".to_string()),
        ("limit", limit.to_string()),
    ];
    match station_client::request_json_auth(
        Method::GET,
        "/conversation/messages",
        &token,
        Some(&query),
        None,
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => station_err(e, "sync from station failed"),
    }
}
