use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use crate::application::chat_storage;
use crate::contracts::{
    AttachmentInput, ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput, ChatScopeCursorSetInput,
    FriendChatAckInput, FriendChatCreateSessionInput, FriendChatListInput, FriendChatListMessagesInput,
    FriendChatOnlineInput, FriendChatPendingInput, FriendChatSendInput, FriendChatSyncInput,
    FriendChatSyncMessagesInput, KeyExchangeFetchInput, KeyExchangeUploadInput, FriendRequestActionInput,
    FriendRequestListInput, FriendRequestSendInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::infrastructure::storage::resolve_user_scope;
use crate::model;
use crate::state::AppState;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

fn token_from_state(state: &State<'_, Arc<AppState>>) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        tracing::error!("Failed to acquire session lock");
        AppResult::fail(ErrorCode::InternalError, "Failed to access session state", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Authentication required — please log in",
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

/// Maps `station_client::request_proto` / `request_json` string errors to the standard Tauri `AppResult` shape.
/// Per error-handling spec: message must be human-readable with context, not an i18n key.
fn fail_station_request(reason: String) -> AppResult<StubPayload> {
    let code = if reason.starts_with("SESSION_REVOKED:") {
        ErrorCode::Unauthorized
    } else {
        ErrorCode::InternalError
    };
    tracing::error!(reason = %reason, "Station request failed");
    AppResult::fail(
        code,
        format!("Station request failed: {}", reason),
        None,
    )
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> serde_json::Value {
    match ts {
        Some(t) => serde_json::Value::Number((t.seconds * 1000 + (t.nanos as i64) / 1_000_000).into()),
        None => serde_json::Value::Null,
    }
}

fn ts_millis_i64(ts: &Option<prost_types::Timestamp>) -> i64 {
    match ts {
        Some(t) => t.seconds * 1000 + (t.nanos as i64) / 1_000_000,
        None => 0,
    }
}

fn bytes_to_b64(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        String::new()
    } else {
        B64.encode(bytes)
    }
}

fn friend_message_attachment_to_json(a: &model::chat::FriendMessageAttachment) -> Value {
    json!({
        "cid": a.cid,
        "filename": a.filename,
        "mimeType": a.mime_type,
        "size": a.size,
        "thumbnailCid": a.thumbnail_cid,
    })
}

fn friend_chat_message_to_json(m: &model::chat::FriendChatMessage) -> Value {
    json!({
        "ulid": m.ulid,
        "sessionUlid": m.session_ulid,
        "senderDid": m.sender_did,
        "receiverDid": m.receiver_did,
        "type": m.r#type,
        "content": m.content,
        "attachments": m.attachments.iter().map(friend_message_attachment_to_json).collect::<Vec<_>>(),
        "replyToUlid": m.reply_to_ulid,
        "status": m.status,
        "sentAt": ts_millis(&m.sent_at),
        "deliveredAt": ts_millis(&m.delivered_at),
        "readAt": ts_millis(&m.read_at),
        "createdAt": ts_millis(&m.created_at),
        "updatedAt": ts_millis(&m.updated_at),
        "encryptedPayload": bytes_to_b64(&m.encrypted_payload),
    })
}

/// Shape expected by `chat_storage::ingest_friend_messages` (snake_case + numeric `sent_at`).
fn friend_message_to_ingest_json(m: &model::chat::FriendChatMessage) -> Value {
    json!({
        "session_ulid": m.session_ulid,
        "ulid": m.ulid,
        "sender_did": m.sender_did,
        "content": m.content,
        "sent_at": ts_millis_i64(&m.sent_at),
    })
}

fn friend_chat_session_to_json(s: &model::chat::FriendChatSession) -> Value {
    json!({
        "ulid": s.ulid,
        "participantADid": s.participant_a_did,
        "participantBDid": s.participant_b_did,
        "lastMessageUlid": s.last_message_ulid,
        "lastMessageAt": ts_millis(&s.last_message_at),
        "unreadCountA": s.unread_count_a,
        "unreadCountB": s.unread_count_b,
        "createdAt": ts_millis(&s.created_at),
        "updatedAt": ts_millis(&s.updated_at),
        "participantADisplayName": s.participant_a_display_name,
        "participantAAvatar": s.participant_a_avatar,
        "participantBDisplayName": s.participant_b_display_name,
        "participantBAvatar": s.participant_b_avatar,
    })
}

fn friend_request_to_json(r: &model::chat::FriendRequest) -> Value {
    json!({
        "id": r.id,
        "senderId": r.sender_id,
        "receiverId": r.receiver_id,
        "message": r.message,
        "status": r.status,
        "createdAt": ts_millis(&r.created_at),
        "respondedAt": ts_millis(&r.responded_at),
        "senderDisplayName": r.sender_display_name,
        "senderAvatar": r.sender_avatar,
        "receiverDisplayName": r.receiver_display_name,
        "receiverAvatar": r.receiver_avatar,
    })
}

fn pending_message_info_to_json(p: &model::chat::PendingMessageInfo) -> Value {
    json!({
        "ulid": p.ulid,
        "senderDid": p.sender_did,
        "sessionUlid": p.session_ulid,
        "encryptedPayload": bytes_to_b64(&p.encrypted_payload),
        "createdAt": p.created_at,
    })
}

fn get_sessions_response_to_json(resp: &model::chat::GetSessionsResponse) -> Value {
    json!({
        "sessions": resp.sessions.iter().map(friend_chat_session_to_json).collect::<Vec<_>>(),
        "total": resp.total,
    })
}

fn create_session_response_to_json(resp: &model::chat::CreateSessionResponse) -> Value {
    json!({
        "session": resp.session.as_ref().map(friend_chat_session_to_json),
        "created": resp.created,
    })
}

fn get_messages_response_to_json(resp: &model::chat::GetMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(friend_chat_message_to_json).collect::<Vec<_>>(),
        "hasMore": resp.has_more,
        "nextCursor": resp.next_cursor,
    })
}

fn get_messages_ingest_value(resp: &model::chat::GetMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(friend_message_to_ingest_json).collect::<Vec<_>>(),
    })
}

fn send_message_response_to_json(resp: &model::chat::SendMessageResponse) -> Value {
    json!({
        "message": resp.message.as_ref().map(friend_chat_message_to_json),
        "relayStatus": resp.relay_status,
    })
}

fn send_message_ingest_value(resp: &model::chat::SendMessageResponse) -> Value {
    match &resp.message {
        Some(m) => json!({ "message": friend_message_to_ingest_json(m) }),
        None => json!({}),
    }
}

fn message_ack_response_to_json(_resp: &model::chat::MessageAckResponse) -> Value {
    json!({})
}

fn sync_messages_response_to_json(resp: &model::chat::SyncMessagesResponse) -> Value {
    json!({
        "synced": resp.synced,
        "failed": resp.failed,
    })
}

fn online_response_to_json(resp: &model::chat::OnlineResponse) -> Value {
    json!({ "status": resp.status })
}

fn get_pending_response_to_json(resp: &model::chat::GetPendingResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(pending_message_info_to_json).collect::<Vec<_>>(),
    })
}

fn get_stats_response_to_json(resp: &model::chat::GetStatsResponse) -> Value {
    json!({
        "onlinePeers": resp.online_peers,
        "pendingMessages": resp.pending_messages,
        "status": resp.status,
    })
}

fn upload_key_bundle_response_to_json(_resp: &model::key_exchange::UploadKeyBundleResponse) -> Value {
    json!({})
}

fn fetch_key_bundle_response_to_json(resp: &model::key_exchange::FetchKeyBundleResponse) -> Value {
    json!({
        "actor_did": resp.actor_did,
        "ik_pub": resp.ik_pub,
        "fingerprint": resp.fingerprint,
        "spk_id": resp.spk_id,
        "spk_pub": resp.spk_pub,
        "spk_sig": resp.spk_sig,
        "opk_id": resp.opk_id,
        "opk_pub": resp.opk_pub,
    })
}

fn send_friend_request_response_to_json(resp: &model::chat::SendFriendRequestResponse) -> Value {
    json!({
        "request": resp.request.as_ref().map(friend_request_to_json),
    })
}

fn accept_friend_request_response_to_json(resp: &model::chat::AcceptFriendRequestResponse) -> Value {
    json!({
        "request": resp.request.as_ref().map(friend_request_to_json),
        "session": resp.session.as_ref().map(friend_chat_session_to_json),
    })
}

fn reject_friend_request_response_to_json(resp: &model::chat::RejectFriendRequestResponse) -> Value {
    json!({
        "request": resp.request.as_ref().map(friend_request_to_json),
    })
}

fn list_friend_requests_response_to_json(resp: &model::chat::ListFriendRequestsResponse) -> Value {
    json!({
        "requests": resp.requests.iter().map(friend_request_to_json).collect::<Vec<_>>(),
        "total": resp.total,
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

fn value_to_sync_message_item(v: &Value) -> Option<model::chat::SyncMessageItem> {
    Some(model::chat::SyncMessageItem {
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

fn map_attachments(inputs: &[AttachmentInput]) -> Vec<model::chat::FriendMessageAttachment> {
    inputs
        .iter()
        .map(|a| model::chat::FriendMessageAttachment {
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
pub fn friend_chat_list_sessions(input: FriendChatListInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
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
        Err(e) => return fail_station_request(e),
    };
    to_stub("friend_chat_list_sessions", get_sessions_response_to_json(&resp))
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
        Err(e) => return fail_station_request(e),
    };
    to_stub("friend_chat_create_session", create_session_response_to_json(&resp))
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
    let resp = match station_client::request_proto::<(), model::chat::GetMessagesResponse>(
        Method::GET,
        "/friend-chat/messages",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    let user_scope = user_scope_from_state(&state);
    let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &get_messages_ingest_value(&resp));
    to_stub("friend_chat_list_messages", get_messages_response_to_json(&resp))
}

#[tauri::command]
pub fn friend_chat_send_message(input: FriendChatSendInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let mut encrypted_payload = Vec::new();
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
        Err(e) => return fail_station_request(e),
    };
    let user_scope = user_scope_from_state(&state);
    let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &send_message_ingest_value(&resp));
    to_stub("friend_chat_send_message", send_message_response_to_json(&resp))
}

#[tauri::command]
pub fn friend_chat_ack_messages(input: FriendChatAckInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
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
        Err(e) => return fail_station_request(e),
    };
    to_stub("friend_chat_ack_messages", message_ack_response_to_json(&resp))
}

#[tauri::command]
pub fn friend_chat_local_search(input: ChatLocalSearchInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Search query is required", None);
    }
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items = match chat_storage::search_friend_messages("__default__", input.query.as_str(), limit) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Local search failed: {}", reason),
                None,
            );
        }
    };
    to_stub("friend_chat_local_search", json!({ "messages": items }))
}

#[tauri::command]
pub fn friend_chat_local_search_scoped(input: ChatLocalSearchInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Search query is required", None);
    }
    let user_scope = user_scope_from_state(&state);
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items = match chat_storage::search_friend_messages(user_scope.as_str(), input.query.as_str(), limit) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Local search failed: {}", reason),
                None,
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
        return AppResult::fail(ErrorCode::InternalError, format!("Failed to set cursor: {}", reason), None);
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
            return AppResult::fail(ErrorCode::InternalError, format!("Failed to get cursor: {}", reason), None);
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
            return AppResult::fail(ErrorCode::InternalError, format!("Failed to get key version: {}", reason), None);
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
            return AppResult::fail(ErrorCode::InternalError, format!("Failed to rotate key: {}", reason), None);
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
            return AppResult::fail(ErrorCode::InternalError, format!("Failed to get cursor: {}", reason), None);
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
        let resp = match station_client::request_proto::<(), model::chat::GetMessagesResponse>(
            Method::GET,
            "/friend-chat/messages",
            &token,
            Some(&query),
            None::<&()>,
        ) {
            Ok(r) => r,
            Err(e) => return fail_station_request(e),
        };
        let data = get_messages_response_to_json(&resp);
        pages_fetched += 1;
        let (incremental_payload, synced_count, latest) = filter_incremental_messages(&data, current_cursor.as_deref());
        let ingest_payload = {
            let arr = incremental_payload
                .get("messages")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let mapped: Vec<Value> = arr
                .iter()
                .filter_map(|item| {
                    let ulid = item.get("ulid").and_then(|v| v.as_str())?;
                    let session_ulid = item.get("sessionUlid").and_then(|v| v.as_str()).or_else(|| item.get("session_ulid").and_then(|v| v.as_str()))?;
                    let sender_did = item.get("senderDid").and_then(|v| v.as_str()).or_else(|| item.get("sender_did").and_then(|v| v.as_str())).unwrap_or("");
                    let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let sent_at = item
                        .get("sentAt")
                        .and_then(|v| v.as_i64())
                        .or_else(|| item.get("sent_at").and_then(|v| v.as_i64()))
                        .unwrap_or(0);
                    Some(json!({
                        "session_ulid": session_ulid,
                        "ulid": ulid,
                        "sender_did": sender_did,
                        "content": content,
                        "sent_at": sent_at,
                    }))
                })
                .collect();
            json!({ "messages": mapped })
        };
        let _ = chat_storage::ingest_friend_messages(user_scope.as_str(), &ingest_payload);
        total_synced += synced_count;
        let server_cursor = next_cursor_from_payload(&data);
        let fallback_latest = extract_latest_ulid(&data);
        let next = server_cursor.or(latest).or(fallback_latest);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(user_scope.as_str(), scope_key.as_str(), new_cursor.as_str());
            current_cursor = Some(new_cursor.clone());
        }
        if !has_more_from_payload(&data) {
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
// Stub commands - registered in main.rs, backed by station protobuf API
// ---------------------------------------------------------------------------

/// Sync messages for a friend-chat session from station.
#[tauri::command]
pub fn friend_chat_sync_messages(input: FriendChatSyncMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let mut items: Vec<model::chat::SyncMessageItem> = Vec::new();
    for v in &input.messages {
        match value_to_sync_message_item(v) {
            Some(it) => items.push(it),
            None => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "Invalid message format in sync batch",
                    None,
                );
            }
        }
    }

    let req = model::chat::SyncMessagesRequest { messages: items };

    let resp = match station_client::request_proto::<model::chat::SyncMessagesRequest, model::chat::SyncMessagesResponse>(
        Method::POST,
        "/friend-chat/message/sync",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_sync_messages", sync_messages_response_to_json(&resp))
}

/// Notify station that the user is online for friend-chat.
#[tauri::command]
pub fn friend_chat_go_online(input: FriendChatOnlineInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::OnlineRequest {
        did: input.did.unwrap_or_default(),
    };

    let resp = match station_client::request_proto::<model::chat::OnlineRequest, model::chat::OnlineResponse>(
        Method::POST,
        "/friend-chat/online",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_go_online", online_response_to_json(&resp))
}

/// Notify station that the user is offline for friend-chat.
#[tauri::command]
pub fn friend_chat_go_offline(input: FriendChatOnlineInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::OnlineRequest {
        did: input.did.unwrap_or_default(),
    };

    let resp = match station_client::request_proto::<model::chat::OnlineRequest, model::chat::OnlineResponse>(
        Method::POST,
        "/friend-chat/offline",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_go_offline", online_response_to_json(&resp))
}

/// Retrieve pending friend-chat messages from station.
#[tauri::command]
pub fn friend_chat_get_pending(input: FriendChatPendingInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![("limit", input.limit.unwrap_or(50).to_string())];

    let resp = match station_client::request_proto::<(), model::chat::GetPendingResponse>(
        Method::GET,
        "/friend-chat/pending",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_get_pending", get_pending_response_to_json(&resp))
}

/// Get friend-chat statistics (unread counts, etc.).
#[tauri::command]
pub fn friend_chat_get_stats(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model::chat::GetStatsResponse>(
        Method::GET,
        "/friend-chat/stats",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_get_stats", get_stats_response_to_json(&resp))
}

#[tauri::command]
pub fn key_exchange_upload_bundle(
    input: KeyExchangeUploadInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let req = model::key_exchange::UploadKeyBundleRequest {
        ik_pub: input.ik_pub,
        spk_id: input.spk_id,
        spk_pub: input.spk_pub,
        spk_sig: input.spk_sig,
        opk_ids: input.opk_ids,
        opk_pubs: input.opk_pubs,
    };
    let resp = match station_client::request_proto::<
        model::key_exchange::UploadKeyBundleRequest,
        model::key_exchange::UploadKeyBundleResponse,
    >(Method::POST, "/key-exchange/keys/bundle", &token, None, Some(&req)) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    to_stub(
        "key_exchange_upload_bundle",
        upload_key_bundle_response_to_json(&resp),
    )
}

#[tauri::command]
pub fn key_exchange_fetch_bundle(
    input: KeyExchangeFetchInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.did.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "error.keyExchange.didRequired", None);
    }
    let req = model::key_exchange::FetchKeyBundleRequest { did: input.did };
    let resp = match station_client::request_proto::<
        model::key_exchange::FetchKeyBundleRequest,
        model::key_exchange::FetchKeyBundleResponse,
    >(
        Method::POST,
        "/key-exchange/keys/bundle/fetch",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    to_stub(
        "key_exchange_fetch_bundle",
        fetch_key_bundle_response_to_json(&resp),
    )
}

// ============================================================================
// Friend Request Commands
// ============================================================================

#[tauri::command]
pub fn friend_chat_send_friend_request(
    input: FriendRequestSendInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

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
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_send_friend_request", send_friend_request_response_to_json(&resp))
}

#[tauri::command]
pub fn friend_chat_accept_friend_request(
    input: FriendRequestActionInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

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
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_accept_friend_request", accept_friend_request_response_to_json(&resp))
}

#[tauri::command]
pub fn friend_chat_reject_friend_request(
    input: FriendRequestActionInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

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
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_reject_friend_request", reject_friend_request_response_to_json(&resp))
}

#[tauri::command]
pub fn friend_chat_list_friend_requests(
    input: FriendRequestListInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(st) = input.status {
        query.push(("status", st.to_string()));
    }
    let limit = input.limit.unwrap_or(20);
    query.push(("limit", limit.to_string()));
    let offset = input.offset.unwrap_or(0);
    query.push(("offset", offset.to_string()));

    let resp = match station_client::request_proto::<(), model::chat::ListFriendRequestsResponse>(
        Method::GET,
        "/friend-chat/friend-requests",
        &token,
        Some(&query),
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("friend_chat_list_friend_requests", list_friend_requests_response_to_json(&resp))
}
