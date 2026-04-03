use crate::application::social_chat::group_service;
use crate::contracts::{
    ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput, ChatScopeCursorSetInput,
    GroupAckOfflineInput, GroupChatListInput, GroupChatListMessagesInput, GroupChatMarkReadInput,
    GroupChatSendInput, GroupChatSyncInput, GroupChatUnreadInput, GroupCreateInput,
    GroupInviteInput, GroupJoinInput, GroupMembersInput, GroupMessageActionInput,
    GroupOfflineMessagesInput, GroupRemoveMemberInput, GroupSearchMessagesInput, GroupUlidInput,
    GroupUpdateInput, GroupUpdateMySettingsInput, GroupUpdateNicknameInput, StubPayload,
};
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
pub fn group_chat_list_groups(input: GroupChatListInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::list_groups(&token, input.limit, input.offset) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_list_messages(input: GroupChatListMessagesInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let user_scope = user_scope_from_state(&state);
    match group_service::list_messages(&token, &user_scope, &input.group_ulid, input.before_ulid.as_deref(), input.limit) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_send_message(input: GroupChatSendInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let user_scope = user_scope_from_state(&state);
    match group_service::send_message(&token, &user_scope, &input.group_ulid, &input.content, input.r#type, input.reply_to_ulid.as_deref(), input.mentioned_dids.as_deref(), input.mention_all) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_unread_count(input: GroupChatUnreadInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::unread_count(&token, input.group_ulid.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_mark_read(input: GroupChatMarkReadInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::mark_read(&token, &input.group_ulid) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_create_group(input: GroupCreateInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::create_group(&token, &input.name, input.description.as_deref(), input.member_dids.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_get_group(input: GroupUlidInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::get_group(&token, &input.group_ulid) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_update_group(input: GroupUpdateInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::update_group(&token, &input.group_ulid, &input.name, input.description.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_invite_to_group(input: GroupInviteInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::invite_to_group(&token, &input.group_ulid, &input.member_dids) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_join_group(input: GroupJoinInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::join_group(&token, &input.group_ulid, input.invitation_ulid.as_deref()) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_leave_group(input: GroupUlidInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::leave_group(&token, &input.group_ulid) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_get_members(input: GroupMembersInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::get_members(&token, &input.group_ulid, input.limit, input.offset) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_remove_member(input: GroupRemoveMemberInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::remove_member(&token, &input.group_ulid, &input.member_did) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_recall_message(input: GroupMessageActionInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::recall_message(&token, &input.group_ulid, &input.message_ulid) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_delete_message(input: GroupMessageActionInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::delete_message(&token, &input.group_ulid, &input.message_ulid) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_search_messages(input: GroupSearchMessagesInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::search_messages(&token, &input.group_ulid, &input.query, input.limit) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_update_nickname(input: GroupUpdateNicknameInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::update_nickname(&token, &input.group_ulid, &input.nickname) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_get_settings(input: GroupUlidInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::get_settings(&token, &input.group_ulid) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_update_settings(input: GroupUpdateMySettingsInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::update_settings(&token, &input.group_ulid, &input.settings_json) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_get_offline_messages(input: GroupOfflineMessagesInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::get_offline_messages(&token, &input.group_ulid, input.limit) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_ack_offline_messages(input: GroupAckOfflineInput, state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::ack_offline_messages(&token, &input.group_ulid, &input.message_ulids) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_get_stats(state: State<AppState>) -> AppResult<Vec<u8>> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match group_service::get_stats(&token) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(reason) => AppResult::fail(ErrorCode::InternalError, &reason, None),
    }
}

#[tauri::command]
pub fn group_chat_local_search(input: ChatLocalSearchInput) -> AppResult<StubPayload> {
    group_service::local_search(&input.query, input.limit)
}

#[tauri::command]
pub fn group_chat_local_search_scoped(input: ChatLocalSearchInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    group_service::local_search_scoped(&user_scope, &input.query, input.limit)
}

#[tauri::command]
pub fn group_chat_set_cursor_scoped(input: ChatScopeCursorSetInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    group_service::set_cursor_scoped(&user_scope, &input.scope, &input.cursor)
}

#[tauri::command]
pub fn group_chat_get_cursor_scoped(input: ChatScopeCursorGetInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    group_service::get_cursor_scoped(&user_scope, &input.scope)
}

#[tauri::command]
pub fn group_chat_get_key_version_scoped(state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    group_service::get_key_version_scoped(&user_scope)
}

#[tauri::command]
pub fn group_chat_rotate_key_scoped(input: ChatKeyRotateInput, state: State<AppState>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    group_service::rotate_key_scoped(&user_scope, input.next_version)
}

#[tauri::command]
pub fn group_chat_sync_from_station_scoped(input: GroupChatSyncInput, state: State<AppState>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(t) => t,
        Err(_) => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    let user_scope = user_scope_from_state(&state);
    group_service::sync_from_station_scoped(&token, &user_scope, &input.group_ulid, input.limit, input.max_pages)
}
