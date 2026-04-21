use std::sync::Arc;
use crate::error::{AppResult, ErrorCode};
use crate::application::chat_storage;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::resolve_user_scope;
use crate::model;
use crate::contracts::{
    AttachmentInput, ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput, ChatScopeCursorSetInput, FriendChatAckInput, FriendChatCreateSessionInput, FriendChatListInput,
    FriendChatListFriendRequestsInput, FriendChatListMessagesInput, FriendChatOnlineInput, FriendChatPendingInput, FriendChatSendFriendRequestInput, FriendChatSendInput,
    FriendChatAcceptFriendRequestInput, FriendChatRejectFriendRequestInput,
    FriendChatSyncInput, FriendChatSyncMessagesInput, StubPayload,
};
use crate::model::chat as model_chat;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use prost::Message;
use crate::state::AppState;
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

fn token_from_state_proto(state: &State<'_, Arc<AppState>>) -> Result<String, AppResult<Vec<u8>>> {
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
    station_client::request_json(method, path, token, query, body)
        .map_err(|e| e.into_app_result("station request failed"))
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn fail_station_error_proto(err: &str) -> AppResult<Vec<u8>> {
    AppResult::fail(ErrorCode::InternalError, err.to_string(), None)
}

fn fail_station_error_proto(err: station_client::StationClientError) -> AppResult<Vec<u8>> {
    err.into_app_result("station request failed")
}

fn fail_station_error_stub(err: station_client::StationClientError) -> AppResult<StubPayload> {
    err.into_app_result("station request failed")
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

fn json_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}

fn json_i32(v: &Value, keys: &[&str]) -> Option<i32> {
    for k in keys {
        if let Some(n) = v.get(*k).and_then(|x| x.as_i64()) {
            return Some(n as i32);
        }
    }
    None
}

fn millis_to_timestamp(ms: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: ms / 1000,
        nanos: ((ms % 1000) * 1_000_000) as i32,
    }
}

fn json_to_optional_timestamp(v: &Value, keys: &[&str]) -> Option<prost_types::Timestamp> {
    let ms = keys.iter().find_map(|k| v.get(*k).and_then(|x| x.as_i64()))?;
    Some(millis_to_timestamp(ms))
}

fn value_to_sync_message_item(v: &Value) -> Option<model_chat::SyncMessageItem> {
    Some(model_chat::SyncMessageItem {
        ulid: json_str(v, &["ulid"])?,
        session_ulid: json_str(v, &["sessionUlid", "session_ulid"])?,
        receiver_did: json_str(v, &["receiverDid", "receiver_did"])?,
        r#type: json_i32(v, &["type"]).unwrap_or(0),
        content: json_str(v, &["content"]).unwrap_or_default(),
        sent_at: json_to_optional_timestamp(v, &["sentAt", "sent_at"]),
        encrypted_payload: Vec::new(),
        attachments: Vec::new(),
        reply_to_ulid: String::new(),
    })
}

fn map_attachments(inputs: &[AttachmentInput]) -> Vec<model_chat::FriendMessageAttachment> {
    inputs
        .iter()
        .map(|a| model_chat::FriendMessageAttachment {
            cid: a.cid.clone(),
            filename: a.filename.clone(),
            mime_type: a.mime_type.clone(),
            size: a.size,
            thumbnail_cid: a.thumbnail_cid.clone().unwrap_or_default(),
        })
        .collect()
}

fn next_cursor_from_payload(data: &Value) -> Option<String> {
    data.get("nextCursor")
        .or_else(|| data.get("next_cursor"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn has_more_from_payload(data: &Value) -> bool {
    data.get("hasMore")
        .or_else(|| data.get("has_more"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}
#[tauri::command]
pub fn friend_chat_list_sessions(input: FriendChatListInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let query = vec![
        ("limit", input.limit.unwrap_or(50).to_string()),
        ("offset", input.offset.unwrap_or(0).to_string()),
    ];
    let resp = match station_client::request_proto::<(), model::chat::GetSessionsResponse>(
        Method::GET,
        "/friend-chat/sessions",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_create_session(input: FriendChatCreateSessionInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.participant_did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "participant_did is required", None);
    }
    let req = model::chat::CreateSessionRequest {
        participant_did: input.participant_did,
    };
    let resp = match station_client::request_proto::<model::chat::CreateSessionRequest, model::chat::CreateSessionResponse>(
        Method::POST,
        "/friend-chat/session/create",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_list_messages(input: FriendChatListMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
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
    let resp = match station_client::request_proto::<(), model::chat::GetMessagesResponse>(
        Method::GET,
        "/friend-chat/messages",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_send_message(input: FriendChatSendInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.session_ulid.trim().is_empty() || input.receiver_did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "session_ulid and receiver_did are required", None);
    }

    let mut encrypted_payload: Vec<u8> = Vec::new();
    if let Some(ref b64) = input.encrypted_payload {
        let t = b64.trim();
        if !t.is_empty() {
            encrypted_payload = match B64.decode(t.as_bytes()) {
                Ok(b) => b,
                Err(e) => {
                    return AppResult::fail(
                        ErrorCode::InvalidArgument,
                        format!("Invalid encrypted_payload: {}", e),
                        None,
                    );
                }
            };
        }
    }

    let req = model::chat::SendMessageRequest {
        session_ulid: input.session_ulid,
        receiver_did: input.receiver_did,
        r#type: input.r#type.unwrap_or(1),
        content: input.content,
        attachments: map_attachments(&input.attachments.unwrap_or_default()),
        reply_to_ulid: input.reply_to_ulid.unwrap_or_default(),
        encrypted_payload,
        client_ulid: input.client_ulid.unwrap_or_default(),
    };

    let resp = match station_client::request_proto::<model::chat::SendMessageRequest, model::chat::SendMessageResponse>(
        Method::POST,
        "/friend-chat/message/send",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_ack_messages(input: FriendChatAckInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.ulids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "ulids is required", None);
    }
    let req = model::chat::MessageAckRequest {
        ulids: input.ulids,
        status: input.status,
    };
    let resp = match station_client::request_proto::<model::chat::MessageAckRequest, model::chat::MessageAckResponse>(
        Method::POST,
        "/friend-chat/message/ack",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
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
pub fn friend_chat_sync_messages(input: FriendChatSyncMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let raw = input.messages_json.trim();
    if raw.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "messages_json is required", None);
    }
    let values: Vec<Value> = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid messages_json: {}", e),
                None,
            );
        }
    };

    let mut items = Vec::new();
    for v in &values {
        if let Some(item) = value_to_sync_message_item(v) {
            items.push(item);
        }
    }
    if items.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "messages_json contains no valid items", None);
    }

    let req = model_chat::SyncMessagesRequest { messages: items };
    let resp = match station_client::request_proto::<model_chat::SyncMessagesRequest, model_chat::SyncMessagesResponse>(
        Method::POST,
        "/friend-chat/message/sync",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Notify station that the user is online for friend-chat.
#[tauri::command]
pub fn friend_chat_go_online(input: FriendChatOnlineInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model_chat::OnlineRequest {
        did: input.did.unwrap_or_default(),
    };
    let resp = match station_client::request_proto::<model_chat::OnlineRequest, model_chat::OnlineResponse>(
        Method::POST,
        "/friend-chat/online",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Notify station that the user is offline for friend-chat.
#[tauri::command]
pub fn friend_chat_go_offline(input: FriendChatOnlineInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model_chat::OnlineRequest {
        did: input.did.unwrap_or_default(),
    };
    let resp = match station_client::request_proto::<model_chat::OnlineRequest, model_chat::OnlineResponse>(
        Method::POST,
        "/friend-chat/offline",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Retrieve pending friend-chat messages from station.
#[tauri::command]
pub fn friend_chat_get_pending(input: FriendChatPendingInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![("limit", input.limit.unwrap_or(50).to_string())];
    let resp = match station_client::request_proto::<(), model_chat::GetPendingResponse>(
        Method::GET,
        "/friend-chat/pending",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Get friend-chat statistics (unread counts, etc.).
#[tauri::command]
pub fn friend_chat_get_stats(state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model_chat::GetStatsResponse>(
        Method::GET,
        "/friend-chat/stats",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_error_proto(&e),
    };
    AppResult::success(resp.encode_to_vec())
}

// ---------------------------------------------------------------------------
// Friend Requests (Station-backed)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn friend_chat_send_friend_request(input: FriendChatSendFriendRequestInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.receiver_did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "receiver_did is required", None);
    }
    let req = model::chat::SendFriendRequestRequest {
        receiver_did: input.receiver_did,
        message: input.message.unwrap_or_default(),
    };
    let resp = match station_client::request_proto::<model::chat::SendFriendRequestRequest, model::chat::SendFriendRequestResponse>(
        Method::POST,
        "/friend-chat/friend-request/send",
        &token,
        None,
        Some(&req),
    ) {
        Ok(resp) => resp,
        Err(error) => return fail_station_error_proto(&error),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_accept_friend_request(input: FriendChatAcceptFriendRequestInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.request_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "request_id is required", None);
    }
    let req = model::chat::AcceptFriendRequestRequest {
        request_id: input.request_id,
    };
    let resp = match station_client::request_proto::<model::chat::AcceptFriendRequestRequest, model::chat::AcceptFriendRequestResponse>(
        Method::POST,
        "/friend-chat/friend-request/accept",
        &token,
        None,
        Some(&req),
    ) {
        Ok(resp) => resp,
        Err(error) => return fail_station_error_proto(&error),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_reject_friend_request(input: FriendChatRejectFriendRequestInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.request_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "request_id is required", None);
    }
    let req = model::chat::RejectFriendRequestRequest {
        request_id: input.request_id,
    };
    let resp = match station_client::request_proto::<model::chat::RejectFriendRequestRequest, model::chat::RejectFriendRequestResponse>(
        Method::POST,
        "/friend-chat/friend-request/reject",
        &token,
        None,
        Some(&req),
    ) {
        Ok(resp) => resp,
        Err(error) => return fail_station_error_proto(&error),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn friend_chat_list_friend_requests(input: FriendChatListFriendRequestsInput, state: State<'_, Arc<AppState>>) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let mut query = Vec::new();
    if let Some(status) = input.status {
        query.push(("status", status.to_string()));
    }
    query.push(("limit", input.limit.unwrap_or(50).clamp(1, 200).to_string()));
    query.push(("offset", input.offset.unwrap_or(0).to_string()));

    let resp = match station_client::request_proto::<(), model::chat::ListFriendRequestsResponse>(
        Method::GET,
        "/friend-chat/friend-requests",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(resp) => resp,
        Err(error) => return fail_station_error_proto(&error),
    };
    AppResult::success(resp.encode_to_vec())
}
