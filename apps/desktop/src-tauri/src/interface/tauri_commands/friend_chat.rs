use crate::application::social_chat::friend_service;
use crate::contracts::{
    ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput, ChatScopeCursorSetInput,
    FriendChatAckInput, FriendChatCreateSessionInput, FriendChatListInput,
    FriendChatListMessagesInput, FriendChatOnlineInput, FriendChatPendingInput,
    FriendChatSendInput, FriendChatSyncInput, FriendChatSyncMessagesInput, StubPayload,
};
use crate::model::chat;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::resolve_user_scope;
use crate::state::AppState;
use prost::Message;
use tauri::State;

fn token_from_state(state: &State<AppState>) -> Result<String, ()> {
    let guard = state.session.lock().map_err(|_| ())?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(());
    }
    Ok(token)
}

fn actor_id_from_state(state: &State<AppState>) -> Option<String> {
    state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.actor_id.clone())
}

fn user_scope_from_state(state: &State<AppState>) -> String {
    let actor_id = actor_id_from_state(state);
    resolve_user_scope(actor_id.as_deref())
}

#[tauri::command]
pub fn friend_chat_list_sessions(input: FriendChatListInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::list_sessions(&token, input.limit, input.offset) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_create_session(input: FriendChatCreateSessionInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::create_session(&token, &input.participant_did) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_list_messages(input: FriendChatListMessagesInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let user_scope = user_scope_from_state(&state);
    match friend_service::list_messages(&token, &user_scope, &input.session_ulid, input.before_ulid.as_deref(), input.limit) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_send_message(input: FriendChatSendInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let user_scope = user_scope_from_state(&state);
    match friend_service::send_message(&token, &user_scope, &input.session_ulid, &input.receiver_did, &input.content, input.r#type, input.reply_to_ulid.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_ack_messages(input: FriendChatAckInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::ack_messages(&token, &input.ulids, input.status) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_sync_messages(input: FriendChatSyncMessagesInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let items: Vec<serde_json::Value> = match serde_json::from_str(&input.messages_json) {
        Ok(v) => v,
        Err(e) => return AppResult::fail(ErrorCode::InvalidArgument, &format!("invalid messages_json: {e}"), None),
    };
    let messages: Vec<chat::SyncMessageItem> = items
        .into_iter()
        .map(|v| chat::SyncMessageItem {
            ulid: v["ulid"].as_str().unwrap_or_default().to_string(),
            session_ulid: v["session_ulid"].as_str().unwrap_or(&input.session_ulid).to_string(),
            receiver_did: v["receiver_did"].as_str().unwrap_or_default().to_string(),
            r#type: v["type"].as_i64().unwrap_or(1) as i32,
            content: v["content"].as_str().unwrap_or_default().to_string(),
            sent_at: None,
        })
        .collect();
    match friend_service::sync_messages(&token, messages) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_go_online(input: FriendChatOnlineInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::go_online(&token, input.did.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_go_offline(input: FriendChatOnlineInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::go_offline(&token, input.did.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_get_pending(input: FriendChatPendingInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::get_pending(&token, input.limit) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_get_stats(state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match friend_service::get_stats(&token) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn friend_chat_local_search(input: ChatLocalSearchInput) -> AppResult<StubPayload> {
    friend_service::local_search(&input.query, input.limit)
}

#[tauri::command]
pub fn friend_chat_local_search_scoped(input: ChatLocalSearchInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    friend_service::local_search_scoped(&user_scope, &input.query, input.limit)
}

#[tauri::command]
pub fn friend_chat_set_cursor_scoped(input: ChatScopeCursorSetInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    friend_service::set_cursor_scoped(&user_scope, &input.scope, &input.cursor)
}

#[tauri::command]
pub fn friend_chat_get_cursor_scoped(input: ChatScopeCursorGetInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    friend_service::get_cursor_scoped(&user_scope, &input.scope)
}

#[tauri::command]
pub fn friend_chat_get_key_version_scoped(state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    friend_service::get_key_version_scoped(&user_scope)
}

#[tauri::command]
pub fn friend_chat_rotate_key_scoped(input: ChatKeyRotateInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    friend_service::rotate_key_scoped(&user_scope, input.next_version)
}

#[tauri::command]
pub fn friend_chat_sync_from_station_scoped(input: FriendChatSyncInput, state: State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let user_scope = user_scope_from_state(&state);
    friend_service::sync_from_station_scoped(&token, &user_scope, &input.session_ulid, input.limit, input.max_pages)
}
