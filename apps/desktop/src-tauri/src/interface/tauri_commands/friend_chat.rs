use std::sync::Arc;
use crate::error::{AppResult, ErrorCode};
use crate::application::chat_storage;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::resolve_user_scope;
use crate::contracts::{
    ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput, ChatScopeCursorSetInput, FriendChatAckInput, FriendChatCreateSessionInput, FriendChatListInput,
    FriendChatListMessagesInput, FriendChatOnlineInput, FriendChatPendingInput, FriendChatSendInput,
    FriendChatSyncInput, FriendChatSyncMessagesInput, StubPayload,
};
use crate::state::AppState;
use reqwest::blocking::Client;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

fn token_from_state(state: &State<'_, Arc<AppState>>) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(ErrorCode::InternalError, "failed to access session state", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn actor_id_from_state(state: &State<'_, Arc<AppState>>) -> Option<String> {
    state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.actor_id.clone())
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>) -> String {
    let actor_id = actor_id_from_state(state);
    resolve_user_scope(actor_id.as_deref())
}

fn request_json(method: Method, path: &str, token: &str, query: Option<&[(&str, String)]>, body: Option<Value>) -> Result<Value, AppResult<StubPayload>> {
    let client = match Client::builder().build() {
        Ok(client) => client,
        Err(error) => {
            return Err(AppResult::fail(ErrorCode::InternalError, "failed to create http client", Some(json!({"reason": error.to_string()}))));
        }
    };
    let mut req = client
        .request(method, format!("{}{}", station_client::station_base_url(), path))
        .bearer_auth(token);
    if let Some(query) = query {
        req = req.query(query);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = match req.send() {
        Ok(response) => response,
        Err(error) => {
            return Err(AppResult::fail(ErrorCode::InternalError, "station request failed", Some(json!({"reason": error.to_string()}))));
        }
    };
    if !response.status().is_success() {
        let code = match response.status().as_u16() {
            400 => ErrorCode::InvalidArgument,
            401 => ErrorCode::Unauthorized,
            403 => ErrorCode::Forbidden,
            404 => ErrorCode::NotFound,
            409 => ErrorCode::Conflict,
            _ => ErrorCode::InternalError,
        };
        return Err(AppResult::fail(code, "station request failed", Some(json!({"status": response.status().as_u16()}))));
    }
    match response.json::<Value>() {
        Ok(data) => Ok(data),
        Err(error) => Err(AppResult::fail(
            ErrorCode::InternalError,
            "invalid station response",
            Some(json!({"reason": error.to_string()})),
        )),
    }
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn extract_latest_ulid(payload: &Value) -> Option<String> {
    let messages = payload.get("messages")?.as_array()?;
    for item in messages {
        if let Some(ulid) = item.get("ulid").and_then(|v| v.as_str()) {
            if !ulid.trim().is_empty() {
                return Some(ulid.to_string());
            }
        }
    }
    None
}

fn filter_incremental_messages(payload: &Value, cursor: Option<&str>) -> (Value, usize, Option<String>) {
    let mut filtered_payload = payload.clone();
    let mut synced_count = 0usize;
    let mut latest: Option<String> = None;
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        let mut out = Vec::new();
        for item in messages {
            let ulid = item
                .get("ulid")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if ulid.is_empty() {
                continue;
            }
            let should_keep = match cursor {
                Some(c) if !c.trim().is_empty() => ulid.as_str() > c,
                _ => true,
            };
            if should_keep {
                synced_count += 1;
                if latest.as_ref().map(|v| ulid.as_str() > v.as_str()).unwrap_or(true) {
                    latest = Some(ulid.clone());
                }
                out.push(item.clone());
            }
        }
        if let Some(obj) = filtered_payload.as_object_mut() {
            obj.insert("messages".to_string(), Value::Array(out));
        }
    }
    (filtered_payload, synced_count, latest)
}

#[tauri::command]
pub fn friend_chat_list_sessions(input: FriendChatListInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let query = vec![
        ("limit", input.limit.unwrap_or(50).to_string()),
        ("offset", input.offset.unwrap_or(0).to_string()),
    ];
    let data = match request_json(Method::GET, "/friend-chat/sessions", &token, Some(&query), None) {
        Ok(data) => data,
        Err(error) => return error,
    };
    to_stub("friend_chat_list_sessions", data)
}

#[tauri::command]
pub fn friend_chat_create_session(input: FriendChatCreateSessionInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.participant_did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "participant_did is required", None);
    }
    let data = match request_json(
        Method::POST,
        "/friend-chat/session/create",
        &token,
        None,
        Some(json!({ "participant_did": input.participant_did })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    to_stub("friend_chat_create_session", data)
}

#[tauri::command]
pub fn friend_chat_list_messages(input: FriendChatListMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.session_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "session_ulid is required", None);
    }
    let mut query = vec![
        ("session_ulid", input.session_ulid),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    if let Some(before) = input.before_ulid {
        query.push(("before_ulid", before));
    }
    let data = match request_json(Method::GET, "/friend-chat/messages", &token, Some(&query), None) {
        Ok(data) => data,
        Err(error) => return error,
    };
    let user_scope = user_scope_from_state(&state);
    let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &data);
    to_stub("friend_chat_list_messages", data)
}

#[tauri::command]
pub fn friend_chat_send_message(input: FriendChatSendInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let data = match request_json(
        Method::POST,
        "/friend-chat/message/send",
        &token,
        None,
        Some(json!({
            "session_ulid": input.session_ulid,
            "receiver_did": input.receiver_did,
            "content": input.content,
            "type": input.r#type.unwrap_or(1),
            "reply_to_ulid": input.reply_to_ulid.unwrap_or_default()
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    let user_scope = user_scope_from_state(&state);
    let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &data);
    to_stub("friend_chat_send_message", data)
}

#[tauri::command]
pub fn friend_chat_ack_messages(input: FriendChatAckInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let data = match request_json(
        Method::POST,
        "/friend-chat/message/ack",
        &token,
        None,
        Some(json!({
            "ulids": input.ulids,
            "status": input.status,
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    to_stub("friend_chat_ack_messages", data)
}

#[tauri::command]
pub fn friend_chat_local_search(input: ChatLocalSearchInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items = match chat_storage::search_friend_messages("__default__", input.query.as_str(), limit) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "local search failed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    to_stub("friend_chat_local_search", json!({ "messages": items }))
}

#[tauri::command]
pub fn friend_chat_local_search_scoped(input: ChatLocalSearchInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let user_scope = user_scope_from_state(&state);
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items = match chat_storage::search_friend_messages(user_scope.as_str(), input.query.as_str(), limit) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "local search failed",
                Some(json!({ "reason": reason })),
            );
        }
    };
    to_stub("friend_chat_local_search_scoped", json!({ "messages": items }))
}

#[tauri::command]
pub fn friend_chat_set_cursor_scoped(input: ChatScopeCursorSetInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    if input.scope.trim().is_empty() || input.cursor.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "scope and cursor are required", None);
    }
    if let Err(reason) = chat_storage::set_scope_cursor(user_scope.as_str(), input.scope.as_str(), input.cursor.as_str()) {
        return AppResult::fail(ErrorCode::InternalError, "set cursor failed", Some(json!({"reason": reason})));
    }
    to_stub("friend_chat_set_cursor_scoped", json!({"ok": true}))
}

#[tauri::command]
pub fn friend_chat_get_cursor_scoped(input: ChatScopeCursorGetInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    if input.scope.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "scope is required", None);
    }
    let cursor = match chat_storage::get_scope_cursor(user_scope.as_str(), input.scope.as_str()) {
        Ok(cursor) => cursor,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InternalError, "get cursor failed", Some(json!({"reason": reason})));
        }
    };
    to_stub("friend_chat_get_cursor_scoped", json!({"cursor": cursor}))
}

#[tauri::command]
pub fn friend_chat_get_key_version_scoped(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    let key_version = match chat_storage::get_chat_key_version(user_scope.as_str()) {
        Ok(version) => version,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InternalError, "get key version failed", Some(json!({"reason": reason})));
        }
    };
    to_stub("friend_chat_get_key_version_scoped", json!({"key_version": key_version}))
}

#[tauri::command]
pub fn friend_chat_rotate_key_scoped(input: ChatKeyRotateInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if input.next_version <= 0 {
        return AppResult::fail(ErrorCode::InvalidArgument, "next_version must be positive", None);
    }
    let user_scope = user_scope_from_state(&state);
    let key_version = match chat_storage::rotate_chat_key(user_scope.as_str(), input.next_version) {
        Ok(version) => version,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InternalError, "rotate key failed", Some(json!({"reason": reason})));
        }
    };
    to_stub("friend_chat_rotate_key_scoped", json!({"key_version": key_version}))
}

#[tauri::command]
pub fn friend_chat_sync_from_station_scoped(input: FriendChatSyncInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.session_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "session_ulid is required", None);
    }
    let user_scope = user_scope_from_state(&state);
    let scope_key = format!("friend:{}", input.session_ulid);
    let cursor = match chat_storage::get_scope_cursor(user_scope.as_str(), scope_key.as_str()) {
        Ok(cursor) => cursor,
        Err(reason) => {
            return AppResult::fail(ErrorCode::InternalError, "get cursor failed", Some(json!({"reason": reason})));
        }
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
        let data = match request_json(Method::GET, "/friend-chat/messages", &token, Some(&query), None) {
            Ok(data) => data,
            Err(error) => return error,
        };
        pages_fetched += 1;
        let (incremental_payload, synced_count, latest) = filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &incremental_payload);
        total_synced += synced_count;
        let server_cursor = data.get("next_cursor").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
        let fallback_latest = extract_latest_ulid(&data);
        let next = server_cursor.or(latest).or(fallback_latest);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(user_scope.as_str(), scope_key.as_str(), new_cursor.as_str());
            current_cursor = Some(new_cursor.clone());
        }
        let has_more = data.get("has_more").and_then(|v| v.as_bool()).unwrap_or(false);
        if !has_more {
            break;
        }
    }
    to_stub(
        "friend_chat_sync_from_station_scoped",
        json!({
            "synced_count": total_synced,
            "pages_fetched": pages_fetched,
            "cursor_before": cursor,
            "cursor_after": current_cursor
        }),
    )
}

// ---------------------------------------------------------------------------
// Stub commands - registered in main.rs, backed by station JSON API
// ---------------------------------------------------------------------------

/// Sync messages for a friend-chat session from station (JSON-based).
#[tauri::command]
pub fn friend_chat_sync_messages(input: FriendChatSyncMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(
        Method::POST,
        "/friend-chat/messages/sync",
        &token,
        None,
        Some(json!({
            "messages": input.messages,
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("friend_chat_sync_messages", data)
}

/// Notify station that the user is online for friend-chat.
#[tauri::command]
pub fn friend_chat_go_online(input: FriendChatOnlineInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let body = match &input.did {
        Some(did) => json!({ "did": did }),
        None => json!({}),
    };

    let data = match request_json(Method::POST, "/friend-chat/online", &token, None, Some(body)) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("friend_chat_go_online", data)
}

/// Notify station that the user is offline for friend-chat.
#[tauri::command]
pub fn friend_chat_go_offline(input: FriendChatOnlineInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let body = match &input.did {
        Some(did) => json!({ "did": did }),
        None => json!({}),
    };

    let data = match request_json(Method::POST, "/friend-chat/offline", &token, None, Some(body)) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("friend_chat_go_offline", data)
}

/// Retrieve pending friend-chat messages from station.
#[tauri::command]
pub fn friend_chat_get_pending(input: FriendChatPendingInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![("limit", input.limit.unwrap_or(50).to_string())];

    let data = match request_json(Method::GET, "/friend-chat/pending", &token, Some(&query), None) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("friend_chat_get_pending", data)
}

/// Get friend-chat statistics (unread counts, etc.).
#[tauri::command]
pub fn friend_chat_get_stats(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(Method::GET, "/friend-chat/stats", &token, None, None) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("friend_chat_get_stats", data)
}
